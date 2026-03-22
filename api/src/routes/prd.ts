/**
 * PRD Decomposition API Route
 *
 * POST /api/prd/decompose — accepts PRD content from multiple sources,
 * decomposes it into implementation cards via the Anthropic API,
 * creates a KbBoard with dependency-ordered cards, labels, and dependencies.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import {
  KbBoard,
  KbColumn,
  KbCard,
  KbLabel,
  KbCardLabel,
  KbCardDependency,
  KbSpec,
  Organization,
  WorkerTask,
} from "../models/index.js";
import { authenticateUser, authenticateApiKey, authenticateSSE } from "../middleware/auth.js";
import { requireCurrentTos } from "../middleware/tos.js";
import { body, validateRequest } from "../middleware/validation.js";
import {
  decomposePrd,
  decomposePrdStreaming,
  decomposePrdWithStories,
  decomposePrdWithStoriesStreaming,
  condensePrd,
} from "../services/prd-decomposer.js";
import { decompositionEmitter } from "../services/decomposition-events.js";
import { getOrgCredentials } from "../services/org-credentials.js";
import { logger } from "../utils/logger.js";
import { validateExternalUrl } from "../utils/url-validator.js";
import {
  validatePrdDependencies,
  repairPrdDependencies,
  createSession,
  getSession,
  deleteSession,
} from "../services/prd-dependency-validator.js";
import type { DecompositionSession } from "../services/prd-dependency-validator.js";
import { createLLMBackend } from "../services/llm-backend.js";

const router = Router();

// =============================================================================
// SSE endpoint — BEFORE auth middleware so it can use authenticateSSE
// (EventSource can't set headers; auth goes via ?token= query param)
// =============================================================================

router.get("/decompose/stream", authenticateSSE, (req: Request, res: Response) => {
  const decompositionId = req.query.decompositionId as string;
  if (!decompositionId) {
    res.status(400).json({ error: "decompositionId query parameter is required" });
    return;
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // Send initial heartbeat
  res.write(": heartbeat\n\n");

  let closed = false;

  const unsubscribe = decompositionEmitter.subscribeToEvents(
    decompositionId,
    (event) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);

      // Close on terminal phases
      if (event.phase === "complete" || event.phase === "error") {
        // Small delay to ensure the client receives the final event
        setTimeout(() => {
          if (!closed) {
            closed = true;
            unsubscribe();
            clearInterval(heartbeat);
            clearTimeout(timeout);
            res.end();
          }
        }, 500);
      }
    },
  );

  // Heartbeat every 30s to keep connection alive through proxies (CloudFront, ALB)
  const heartbeat = setInterval(() => {
    if (!closed) {
      res.write(": heartbeat\n\n");
    }
  }, 30_000);

  // 15-minute timeout (extended for spec validation gate user interaction)
  const timeout = setTimeout(() => {
    if (!closed) {
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
      res.write(`data: ${JSON.stringify({ phase: "error", error: "Stream timeout" })}\n\n`);
      res.end();
    }
  }, 15 * 60 * 1000);

  req.on("close", () => {
    if (!closed) {
      closed = true;
      unsubscribe();
      clearTimeout(timeout);
      clearInterval(heartbeat);
    }
  });
});

// Accept either JWT (dashboard) or API key (agent) authentication
router.use((req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey) {
    return authenticateApiKey(req, res, next);
  }
  return authenticateUser(req, res, next);
});
router.use(requireCurrentTos);

// =============================================================================
// Helper: Derive board prefix from name (same logic as boards.ts)
// =============================================================================

function derivePrefix(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s\-\u2013\u2014_]+/)  // split on spaces, hyphens, en/em dashes, underscores
    .filter((w) => /[A-Za-z0-9]/.test(w));  // drop non-alphanumeric tokens

  if (words.length >= 2) {
    return words
      .slice(0, 5)
      .map((w) => w[0])
      .join("")
      .replace(/[^A-Z0-9]/gi, "")  // strip any remaining non-alphanumeric
      .toUpperCase();
  }

  const word = words[0] || "BD";
  if (word.length <= 3) return word.toUpperCase();
  return word.substring(0, 3).toUpperCase();
}

async function generateUniquePrefix(
  boardRepo: import("typeorm").Repository<KbBoard>,
  orgId: string,
  name: string,
): Promise<string> {
  let prefix = derivePrefix(name);

  const existing = await boardRepo
    .createQueryBuilder("b")
    .where("b.orgId = :orgId", { orgId })
    .select("b.prefix")
    .getMany();
  const usedPrefixes = new Set(existing.map((b) => b.prefix));

  if (!usedPrefixes.has(prefix)) return prefix;

  let attempt = 2;
  const base = prefix;
  while (usedPrefixes.has(prefix)) {
    prefix = `${base}${attempt}`;
    attempt++;
  }
  return prefix;
}

// =============================================================================
// Helper: Fetch PRD content from a repo file via SCM API
// =============================================================================

async function fetchFileFromRepo(
  repoPath: string,
  githubRepo: string,
  org: Organization,
): Promise<string> {
  const credentials = await getOrgCredentials(org.id);
  const scmProvider = org.scmProvider || "github";
  const token = credentials.scmToken;

  if (!token) {
    throw new Error(
      `No SCM access token configured for ${scmProvider}. Add one in Settings > Integrations.`,
    );
  }

  let url: string;
  const headers: Record<string, string> = {
    "User-Agent": "WorkerMill-API",
  };

  switch (scmProvider) {
    case "github": {
      // GitHub Contents API — returns raw file content
      const encodedPath = repoPath
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      url = `https://api.github.com/repos/${githubRepo}/contents/${encodedPath}`;
      headers["Authorization"] = `Bearer ${token}`;
      headers["Accept"] = "application/vnd.github.raw";
      break;
    }
    case "bitbucket": {
      // Bitbucket 2.0 API — raw file download
      const encodedPath = repoPath
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      url = `https://api.bitbucket.org/2.0/repositories/${githubRepo}/src/HEAD/${encodedPath}`;
      headers["Authorization"] = `Bearer ${token}`;
      break;
    }
    case "gitlab": {
      // GitLab API — raw file download
      const projectEncoded = encodeURIComponent(githubRepo);
      const filePathEncoded = encodeURIComponent(repoPath);
      const baseUrl = org.scmBaseUrl || "https://gitlab.com";
      url = `${baseUrl}/api/v4/projects/${projectEncoded}/repository/files/${filePathEncoded}/raw?ref=HEAD`;
      // Validate GitLab URL against SSRF (self-hosted instances use user-supplied base URL)
      const gitlabUrlCheck = await validateExternalUrl(url);
      if (!gitlabUrlCheck.valid) {
        throw new Error(`Invalid GitLab URL: ${gitlabUrlCheck.reason}`);
      }
      headers["PRIVATE-TOKEN"] = token;
      break;
    }
    default:
      throw new Error(`Unsupported SCM provider: ${scmProvider}`);
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch file from ${scmProvider} (${response.status}): ${response.statusText}`,
    );
  }

  return response.text();
}

// =============================================================================
// Default board columns
// =============================================================================

const DEFAULT_BOARD_COLUMNS = [
  { name: "To Do", position: 0, color: "#6b7280" },
  { name: "In Progress", position: 1, color: "#f59e0b" },
  { name: "Review", position: 2, color: "#8b5cf6" },
  { name: "Approved", position: 3, color: "#3b82f6" },
  { name: "Deployed", position: 4, color: "#10b981" },
];

// =============================================================================
// Label color palette (consistent colors for auto-created labels)
// =============================================================================

const LABEL_COLORS: Record<string, string> = {
  // Personas
  backend_developer: "#3b82f6",
  frontend_developer: "#8b5cf6",
  devops_engineer: "#f59e0b",
  security_engineer: "#ef4444",
  qa_engineer: "#10b981",
  tech_writer: "#6366f1",
  project_manager: "#ec4899",
  // Priorities
  urgent: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#6b7280",
};

function getLabelColor(name: string): string {
  return LABEL_COLORS[name.toLowerCase()] || "#6b7280";
}

// =============================================================================
// Helper: Create board from decomposed PRD (shared by /decompose and /proceed)
// =============================================================================

interface BoardCreationOptions {
  boardNameOverride?: string;
  specId?: string;
  syncToTracker?: boolean;
  userId?: string;
  source?: string;
  decompositionId?: string;
  emit?: (event: import("../services/decomposition-events.js").DecompositionEvent) => void;
}

async function createBoardFromDecomposition(
  decomposed: import("../services/prd-decomposer.js").DecomposedPrd,
  prdContent: string,
  org: Organization,
  opts: BoardCreationOptions,
): Promise<{
  board: KbBoard;
  prefix: string;
  createdCards: KbCard[];
  decomposed: import("../services/prd-decomposer.js").DecomposedPrd;
  trackerSync: unknown;
}> {
  const finalBoardName = opts.boardNameOverride || decomposed.boardName;

  const result = await AppDataSource.transaction(async (em) => {
    const boardRepo = em.getRepository(KbBoard);
    const colRepo = em.getRepository(KbColumn);
    const cardRepo = em.getRepository(KbCard);
    const depRepo = em.getRepository(KbCardDependency);
    const labelRepo = em.getRepository(KbLabel);
    const cardLabelRepo = em.getRepository(KbCardLabel);

    // Get max board position
    const maxPos = await boardRepo
      .createQueryBuilder("b")
      .where("b.orgId = :orgId", { orgId: org.id })
      .select("MAX(b.position)", "max")
      .getRawOne();

    const prefix = await generateUniquePrefix(boardRepo, org.id, finalBoardName);

    // Create board with quality gates as first-class columns
    const board = boardRepo.create({
      orgId: org.id,
      name: finalBoardName,
      description: `Auto-generated from PRD decomposition`,
      position: (maxPos?.max ?? -1) + 1,
      prefix,
      nextCardNumber: 1,
      createdById: opts.userId || null,
      qualityGateCommands: decomposed.qualityGates?.length ? decomposed.qualityGates : null,
      ciWorkflowPath: decomposed.ciWorkflowPath || null,
      prdContent: prdContent,
      prdSource: opts.source || "text",
    });
    await boardRepo.save(board);

    // Fire-and-forget: condense the PRD for worker prompts (reduces token usage)
    const condenseKey = (await getOrgCredentials(org.id).catch(() => null))?.anthropicApiKey || undefined;
    condensePrd(prdContent, condenseKey).then(async (condensed) => {
      if (condensed !== prdContent) {
        try {
          await boardRepo.update({ id: board.id, orgId: org.id }, { prdContent: condensed });
          logger.info(`[PRD] Board ${board.id} PRD condensed in background`);
        } catch (err) {
          logger.warn(`[PRD] Failed to save condensed PRD: ${err instanceof Error ? err.message : err}`);
        }
      }
    }).catch(() => { /* non-fatal */ });

    // Create default columns
    const columns: KbColumn[] = [];
    for (const def of DEFAULT_BOARD_COLUMNS) {
      const col = colRepo.create({
        boardId: board.id,
        name: def.name,
        position: def.position,
        color: def.color,
      });
      columns.push(col);
    }
    await colRepo.save(columns);

    // Find the "To Do" column
    const todoColumn = columns.find((c) => c.name === "To Do")!;

    // Atomically claim card numbers for all cards at once
    const cardCount = decomposed.cards.length;
    const [{ next_num }] = await em.query(
      `UPDATE "kb_boards" SET "next_card_number" = "next_card_number" + $1 WHERE "id" = $2 AND "org_id" = $3 RETURNING "next_card_number" - $1 AS next_num`,
      [cardCount, board.id, org.id],
    );
    const startNumber = Number(next_num) || 1;

    // Create cards in the "To Do" column
    const createdCards: KbCard[] = [];
    for (let i = 0; i < decomposed.cards.length; i++) {
      const dc = decomposed.cards[i];

      let description = dc.description;
      if (dc.stories && dc.stories.length > 0) {
        description += `\n\n<!-- PRECOMPUTED_STORIES_JSON\n${JSON.stringify(dc.stories)}\nEND_PRECOMPUTED_STORIES -->`;
      }

      const card = cardRepo.create({
        boardId: board.id,
        columnId: todoColumn.id,
        title: dc.title,
        description,
        position: i,
        priority: dc.priority,
        cardNumber: startNumber + i,
        githubRepo: org.getDefaultRepo() || null,
      });
      createdCards.push(card);
    }
    await cardRepo.save(createdCards);

    // Create dependencies based on dependencyIndices
    const dependencies: KbCardDependency[] = [];
    for (let i = 0; i < decomposed.cards.length; i++) {
      const dc = decomposed.cards[i];
      for (const depIdx of dc.dependencyIndices) {
        if (depIdx >= 0 && depIdx < createdCards.length && depIdx !== i) {
          const dep = depRepo.create({
            cardId: createdCards[i].id,
            dependsOnCardId: createdCards[depIdx].id,
          });
          dependencies.push(dep);
        }
      }
    }
    if (dependencies.length > 0) {
      await depRepo.save(dependencies);
    }

    // Create labels and card-label associations
    const existingLabels = await labelRepo.find({ where: { orgId: org.id } });
    const labelMap = new Map(existingLabels.map((l) => [l.name.toLowerCase(), l]));

    async function getOrCreateLabel(name: string): Promise<KbLabel> {
      const key = name.toLowerCase();
      const existing = labelMap.get(key);
      if (existing) return existing;

      const label = labelRepo.create({
        orgId: org.id,
        name,
        color: getLabelColor(name),
      });
      await labelRepo.save(label);
      labelMap.set(key, label);
      return label;
    }

    const cardLabelsToSave: KbCardLabel[] = [];
    for (let i = 0; i < decomposed.cards.length; i++) {
      const dc = decomposed.cards[i];
      const card = createdCards[i];

      const personaLabel = await getOrCreateLabel(dc.persona);
      cardLabelsToSave.push(
        cardLabelRepo.create({ cardId: card.id, labelId: personaLabel.id }),
      );

      for (const labelName of dc.labels) {
        const label = await getOrCreateLabel(labelName);
        if (label.id !== personaLabel.id) {
          cardLabelsToSave.push(
            cardLabelRepo.create({ cardId: card.id, labelId: label.id }),
          );
        }
      }
    }
    if (cardLabelsToSave.length > 0) {
      await cardLabelRepo.save(cardLabelsToSave);
    }

    return { board, prefix, createdCards, decomposed };
  });

  // Link spec to board (if spec-driven decomposition)
  if (opts.specId) {
    const specRepo = AppDataSource.getRepository(KbSpec);
    const specRecord = await specRepo.findOne({ where: { id: opts.specId, orgId: org.id } });
    if (specRecord) {
      await specRepo.update(
        { id: specRecord.id },
        { boardId: result.board.id, status: "decomposed" as const },
      );
      await AppDataSource.getRepository(KbBoard).update(
        { id: result.board.id },
        { specId: specRecord.id },
      );
    }
  }

  // Sync to external tracker if requested
  let trackerSync = null;
  if (opts.syncToTracker !== false) {
    try {
      const { syncBoardToTracker } = await import("../services/tracker-sync.js");
      trackerSync = await syncBoardToTracker(result.board.id, org.id);
    } catch (err) {
      logger.warn("External tracker sync failed (non-blocking)", { error: String(err) });
    }
  }

  // Emit completion
  opts.emit?.({
    phase: "complete",
    boardId: result.board.id,
    detail: `Board "${result.board.name}" created with ${result.createdCards.length} cards`,
  });

  logger.info("PRD decomposed into board", {
    boardId: result.board.id,
    boardName: result.board.name,
    cardCount: result.createdCards.length,
    orgId: org.id,
    userId: opts.userId || "agent",
  });

  return { ...result, trackerSync };
}

// =============================================================================
// POST /api/prd/decompose
// =============================================================================

/**
 * Decompose a PRD into a board with dependency-ordered cards.
 *
 * Sources: text (direct paste), file (base64 encoded), url (fetch from URL),
 * repo (fetch from GitHub/Bitbucket/GitLab repo).
 */
router.post(
  "/decompose",
  body("source")
    .isString()
    .isIn(["text", "file", "url", "repo"])
    .withMessage('source must be one of: text, file, url, repo'),
  body("content")
    .optional()
    .isString()
    .isLength({ max: 500000 })
    .withMessage("content must be a string (max 500KB)"),
  body("fileUrl")
    .optional()
    .isString()
    .isURL()
    .withMessage("fileUrl must be a valid URL"),
  body("repoPath")
    .optional()
    .isString()
    .isLength({ max: 1000 })
    .withMessage("repoPath must be a string (max 1000 chars)"),
  body("githubRepo")
    .optional()
    .isString()
    .isLength({ max: 255 })
    .withMessage("githubRepo must be a string (max 255 chars)"),
  body("boardName")
    .optional()
    .isString()
    .isLength({ max: 200 })
    .withMessage("boardName must be a string (max 200 chars)"),
  body("specId").optional().isUUID(),
  body("syncToTracker")
    .optional()
    .isBoolean()
    .withMessage("syncToTracker must be a boolean"),
  body("decompositionId")
    .optional()
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage("decompositionId must be a non-empty string"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const user = req.user; // may be undefined when using API key auth (agent)
      const {
        source,
        content: contentFromBody,
        fileUrl,
        repoPath,
        githubRepo,
        boardName: boardNameOverride,
        syncToTracker,
        decompositionId,
      } = req.body;
      let content = contentFromBody;

      const emitDecomp = decompositionId
        ? (event: import("../services/decomposition-events.js").DecompositionEvent) =>
            decompositionEmitter.emitEvent(decompositionId, event)
        : undefined;

      // ---------------------------------------------------------------
      // 0. If specId provided, load spec and validate quality gate
      // ---------------------------------------------------------------
      let specRecord: KbSpec | null = null;
      if (req.body.specId) {
        const specRepo = AppDataSource.getRepository(KbSpec);
        specRecord = await specRepo.findOne({
          where: { id: req.body.specId, orgId: org.id },
        });
        if (!specRecord) {
          res.status(404).json({ error: "Spec not found" });
          return;
        }
        if (!specRecord.content) {
          res.status(400).json({ error: "Spec has no content" });
          return;
        }
        // Check quality gate
        if (
          org.specMinQualityScore > 0 &&
          (specRecord.qualityScore === null ||
            specRecord.qualityScore < org.specMinQualityScore)
        ) {
          res.status(400).json({
            error: `Spec quality score (${specRecord.qualityScore ?? "not scored"}) is below org minimum (${org.specMinQualityScore})`,
          });
          return;
        }
        // Use spec content for decomposition if no explicit content provided
        if (!content) {
          content = specRecord.content;
        }
      }

      // ---------------------------------------------------------------
      // 1. Resolve PRD content from the specified source
      // ---------------------------------------------------------------
      let prdContent: string;

      switch (source) {
        case "text": {
          if (!content || content.trim().length === 0) {
            res.status(400).json({ error: "content is required for text source" });
            return;
          }
          prdContent = content;
          break;
        }

        case "file": {
          if (!content || content.trim().length === 0) {
            res.status(400).json({ error: "content (base64) is required for file source" });
            return;
          }
          try {
            prdContent = Buffer.from(content, "base64").toString("utf-8");
          } catch {
            res.status(400).json({ error: "Invalid base64 content" });
            return;
          }
          if (prdContent.trim().length === 0) {
            res.status(400).json({ error: "Decoded file content is empty" });
            return;
          }
          break;
        }

        case "url": {
          if (!fileUrl) {
            res.status(400).json({ error: "fileUrl is required for url source" });
            return;
          }
          // Validate URL against SSRF before fetching
          const fileUrlCheck = await validateExternalUrl(fileUrl);
          if (!fileUrlCheck.valid) {
            res.status(400).json({ error: `Invalid URL: ${fileUrlCheck.reason}` });
            return;
          }
          try {
            const urlResponse = await fetch(fileUrl, {
              headers: { "User-Agent": "WorkerMill-API" },
            });
            if (!urlResponse.ok) {
              res.status(400).json({
                error: `Failed to fetch URL (${urlResponse.status}): ${urlResponse.statusText}`,
              });
              return;
            }
            prdContent = await urlResponse.text();
          } catch (err) {
            res.status(400).json({
              error: `Failed to fetch URL: ${err instanceof Error ? err.message : String(err)}`,
            });
            return;
          }
          if (prdContent.trim().length === 0) {
            res.status(400).json({ error: "Fetched URL content is empty" });
            return;
          }
          break;
        }

        case "repo": {
          if (!repoPath) {
            res.status(400).json({ error: "repoPath is required for repo source" });
            return;
          }
          const repo = githubRepo || org.getDefaultRepo();
          if (!repo) {
            res.status(400).json({
              error: "No repository specified. Provide githubRepo or configure a default in org settings.",
            });
            return;
          }
          try {
            prdContent = await fetchFileFromRepo(repoPath, repo, org);
          } catch (err) {
            res.status(400).json({
              error: `Failed to fetch file from repo: ${err instanceof Error ? err.message : String(err)}`,
            });
            return;
          }
          if (prdContent.trim().length === 0) {
            res.status(400).json({ error: "Fetched repo file content is empty" });
            return;
          }
          break;
        }

        default:
          res.status(400).json({ error: `Unknown source: ${source}` });
          return;
      }

      // ---------------------------------------------------------------
      // 2. Decompose PRD via planning agent model (or use pre-decomposed data from agent)
      // ---------------------------------------------------------------
      const { preDecomposed } = req.body;
      let decomposed;

      const hasPreDecomposed = preDecomposed && preDecomposed.boardName && Array.isArray(preDecomposed.cards);

      // When streaming (decompositionId present), respond 202 immediately
      // so CloudFront doesn't timeout. The heavy LLM + board-creation work
      // runs after the response; the frontend gets the result via SSE.
      const isStreaming = !!decompositionId;
      if (isStreaming) {
        res.status(202).json({ accepted: true, decompositionId });
      }

      if (hasPreDecomposed) {
        // Agent already decomposed locally — validate and sanitize the data
        logger.info("Using pre-decomposed PRD from agent", {
          boardName: preDecomposed.boardName,
          cardCount: preDecomposed.cards.length,
          orgId: org.id,
        });
        try {
          const { validateDecomposedPrd } = await import("../services/prd-decomposer.js");
          decomposed = validateDecomposedPrd(preDecomposed);
        } catch (valErr) {
          logger.error("Pre-decomposed PRD validation failed", {
            error: valErr instanceof Error ? valErr.message : String(valErr),
          });
          if (!isStreaming) {
            res.status(400).json({
              error: `Invalid pre-decomposed PRD: ${valErr instanceof Error ? valErr.message : String(valErr)}`,
            });
          }
          emitDecomp?.({ phase: "error", error: `Invalid pre-decomposed PRD: ${valErr instanceof Error ? valErr.message : String(valErr)}` });
          return;
        }
      } else {
        // Use the planning agent model/provider from org settings
        const planProvider = org.planningAgentProvider || "anthropic";
        const planModel = org.planningAgentModel || org.defaultWorkerModel;
        const orgCreds = await getOrgCredentials(org.id);

        logger.info("Decomposing PRD server-side", {
          provider: planProvider,
          model: planModel,
          orgId: org.id,
        });

        emitDecomp?.({ phase: "resolving_content", detail: "Content resolved, starting decomposition" });

        // Always use story-level decomposition for PRD builds — the decomposer
        // produces pre-computed stories per card for parallel expert execution.
        // The org's prdPlanningMode (strict/simplified) only controls the
        // per-card planner critic loop, not the decomposition step.

        try {
          if (planProvider === "anthropic") {
            if (decompositionId) {
              // Streaming path — emit events to SSE clients
              decomposed = await decomposePrdWithStoriesStreaming(
                prdContent,
                planModel,
                orgCreds.anthropicApiKey || undefined,
                decompositionId,
              );
            } else {
              // Non-streaming path (agents, backward compat)
              decomposed = await decomposePrdWithStories(
                prdContent,
                planModel,
                orgCreds.anthropicApiKey || undefined,
              );
            }
          } else {
            // Non-Anthropic — use Vercel AI SDK via planning agent config
            const { createModel } = await import("../services/planning-agent/config.js");
            const { generateText } = await import("ai");
            const { SYSTEM_PROMPT_WITH_STORIES } = await import("../services/prd-decomposer.js");

            const providerKey = planProvider === "openai" ? orgCreds.openaiApiKey
              : planProvider === "google" ? orgCreds.googleApiKey
              : "";

            if (!providerKey && planProvider !== "ollama") {
              const msg = `No API key configured for ${planProvider}. Add one in Settings > Integrations.`;
              if (!isStreaming) {
                res.status(400).json({ error: msg });
              }
              emitDecomp?.({ phase: "error", error: msg });
              return;
            }

            const model = createModel(
              planProvider,
              planModel,
              providerKey || "",
              org.ollamaBaseUrl || undefined,
            );

            const result = await generateText({
              model,
              system: SYSTEM_PROMPT_WITH_STORIES,
              prompt: `Decompose this PRD into implementation cards:\n\n${prdContent}`,
              maxOutputTokens: 128000,
            });

            const { validateDecomposedPrd } = await import("../services/prd-decomposer.js");
            // Strip markdown fences if present
            let jsonText = result.text.trim();
            const fence = jsonText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
            if (fence) jsonText = fence[1].trim();
            decomposed = validateDecomposedPrd(JSON.parse(jsonText));
          }
        } catch (err) {
          logger.error("PRD decomposition failed", {
            orgId: org.id,
            provider: planProvider,
            model: planModel,
            error: err instanceof Error ? err.message : String(err),
          });
          if (!isStreaming) {
            res.status(500).json({
              error: `PRD decomposition failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
          emitDecomp?.({ phase: "error", error: `PRD decomposition failed: ${err instanceof Error ? err.message : String(err)}` });
          return;
        }
      }

      // ---------------------------------------------------------------
      // 3. Create board, columns, cards, dependencies, and labels
      // ---------------------------------------------------------------
      emitDecomp?.({ phase: "creating_board", detail: "Creating board and cards" });

      const result = await createBoardFromDecomposition(decomposed, prdContent, org, {
        boardNameOverride,
        specId: specRecord?.id,
        syncToTracker: syncToTracker !== false,
        userId: user?.id,
        source,
        decompositionId,
        emit: emitDecomp,
      });

      if (!isStreaming) {
        res.status(201).json({
          boardId: result.board.id,
          boardName: result.board.name,
          prefix: result.prefix,
          cardCount: result.createdCards.length,
          cards: result.createdCards.map((card, i) => ({
            id: card.id,
            cardNumber: card.cardNumber,
            title: card.title,
            dependencies: result.decomposed.cards[i].dependencyIndices,
            estimatedSteps: result.decomposed.cards[i].estimatedSteps,
          })),
          trackerSync: result.trackerSync,
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (req.body.decompositionId) {
        decompositionEmitter.emitEvent(req.body.decompositionId, {
          phase: "error",
          error: errorMsg,
        });
      }
      logger.error("Error decomposing PRD", {
        error: errorMsg,
        stack: error instanceof Error ? error.stack : undefined,
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "PRD decomposition failed" });
      }
    }
  },
);

export default router;
