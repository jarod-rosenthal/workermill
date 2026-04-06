import { streamText } from "ai";
import { z } from "zod";
import fs from "fs";
import { createModel } from "./engine/model-factory.js";
import type { AIProvider } from "./engine/types.js";
import { SYSTEM_PROMPT_WITH_STORIES } from "./prompts/prd-prompts.js";
import type { CliConfig } from "./config.js";
import { getProviderForPersona } from "./config.js";
import { extractGithubIssueNumber } from "./ticket-ops.js";

export interface ProgramEpic {
  title: string;
  issueKeys: string[];
}

interface ParentIssueData {
  title: string;
  body: string;
}

export interface ProgramCard {
  title: string;
  description: string;
  dependencyIndices: number[];
  labels: string[];
}

export interface ProgramDecomposition {
  boardName: string;
  cards: ProgramCard[];
}

interface CreateIssueResult {
  number: number;
  url: string;
}

interface RepositoryContext {
  established: boolean;
  manifests: string[];
  sourceDirs: string[];
  testDirs: string[];
}

const PROGRAM_SECTION_START = "<!-- WORKERMILL_PROGRAM_START -->";
const PROGRAM_SECTION_END = "<!-- WORKERMILL_PROGRAM_END -->";

const ProgramDecompositionSchema = z.object({
  boardName: z.string().min(1),
  cards: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      dependencyIndices: z.array(z.number().int().min(0)).default([]),
      labels: z.array(z.string()).default([]),
    }),
  ).min(1).max(20),
});

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function parseJsonObject(text: string): unknown {
  const direct = stripMarkdownFences(text);
  try {
    return JSON.parse(direct);
  } catch {
    const first = direct.indexOf("{");
    const last = direct.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      return JSON.parse(direct.slice(first, last + 1));
    }
    throw new Error("No JSON object found in decomposer response");
  }
}

function normalizeDependencyIndices(cards: ProgramCard[]): ProgramCard[] {
  return cards.map((card, idx) => {
    const seen = new Set<number>();
    const deps = card.dependencyIndices
      .filter((dep) => dep >= 0 && dep < cards.length && dep !== idx)
      .filter((dep) => {
        if (seen.has(dep)) return false;
        seen.add(dep);
        return true;
      });
    return { ...card, dependencyIndices: deps };
  });
}

function detectRepositoryContext(cwd = process.cwd()): RepositoryContext {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(cwd, { withFileTypes: true }).map((entry) => entry.name);
  } catch {
    return { established: false, manifests: [], sourceDirs: [], testDirs: [] };
  }

  const manifests = [
    "package.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "go.mod",
    "pyproject.toml",
    "Cargo.toml",
    "pom.xml",
    "docker-compose.yml",
    "docker-compose.yaml",
  ].filter((name) => entries.includes(name));

  const sourceDirs = ["src", "app", "api", "server", "client", "web", "packages", "services", "backend", "frontend"]
    .filter((name) => entries.includes(name));
  const testDirs = ["tests", "test", "__tests__", "e2e", "integration"].filter((name) => entries.includes(name));

  const established = manifests.length > 0 || sourceDirs.length > 0 || testDirs.length > 0;
  return { established, manifests, sourceDirs, testDirs };
}

function buildRepositoryContextPrompt(context: RepositoryContext, cwd = process.cwd()): string {
  const lines = [
    "Repository Context (from local checkout):",
    `- root: ${cwd}`,
    `- established repository: ${context.established ? "yes" : "no"}`,
    `- manifests: ${context.manifests.length > 0 ? context.manifests.join(", ") : "none detected"}`,
    `- source directories: ${context.sourceDirs.length > 0 ? context.sourceDirs.join(", ") : "none detected"}`,
    `- test directories: ${context.testDirs.length > 0 ? context.testDirs.join(", ") : "none detected"}`,
  ];
  return lines.join("\n");
}

function countPatternMatches(text: string, patterns: RegExp[]): number {
  let total = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) total += 1;
  }
  return total;
}

function validateExistingRepoDecomposition(
  decomposition: ProgramDecomposition,
  context: RepositoryContext,
): void {
  if (!context.established) return;

  const greenfieldPatterns = [
    /\bfrom scratch\b/i,
    /\bnew project\b/i,
    /\bscaffold/i,
    /\bbootstrap/i,
    /\binitialize\b/i,
    /\bboilerplate\b/i,
    /\bsetup (the )?project\b/i,
    /\bcreate (the )?foundation\b/i,
  ];
  const existingRepoPatterns = [
    /\bexisting\b/i,
    /\bcurrent\b/i,
    /\bextend\b/i,
    /\bmodify\b/i,
    /\bupdate\b/i,
    /\brefactor\b/i,
    /\bintegrate\b/i,
  ];

  let greenfieldCards = 0;
  let existingCards = 0;
  for (const card of decomposition.cards) {
    const text = `${card.title}\n${card.description}`;
    if (countPatternMatches(text, greenfieldPatterns) > 0) greenfieldCards += 1;
    if (countPatternMatches(text, existingRepoPatterns) > 0) existingCards += 1;
  }

  const firstCardText = decomposition.cards.length > 0
    ? `${decomposition.cards[0].title}\n${decomposition.cards[0].description}`
    : "";
  const firstCardLooksGreenfield = /foundation|scaffold|bootstrap|from scratch|initialize/i.test(firstCardText);
  const majorityGreenfield = greenfieldCards >= Math.max(1, Math.ceil(decomposition.cards.length * 0.6));

  if ((majorityGreenfield && existingCards === 0) || firstCardLooksGreenfield) {
    throw new Error(
      "Program decomposition rejected: plan is greenfield-biased for an existing repository. " +
      "Require delta-only cards that extend current code and test patterns.",
    );
  }
}

function topologicalCardOrder(cards: ProgramCard[]): number[] {
  const indegree = new Array(cards.length).fill(0);
  const adj = new Map<number, number[]>();

  for (let i = 0; i < cards.length; i++) {
    adj.set(i, []);
  }

  cards.forEach((card, idx) => {
    for (const dep of card.dependencyIndices) {
      indegree[idx] += 1;
      adj.get(dep)?.push(idx);
    }
  });

  const queue: number[] = [];
  for (let i = 0; i < indegree.length; i++) {
    if (indegree[i] === 0) queue.push(i);
  }

  const ordered: number[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    ordered.push(n);
    for (const neighbor of adj.get(n) || []) {
      indegree[neighbor] -= 1;
      if (indegree[neighbor] === 0) queue.push(neighbor);
    }
  }

  // Cycle fallback: append any missing indices in source order.
  if (ordered.length < cards.length) {
    for (let i = 0; i < cards.length; i++) {
      if (!ordered.includes(i)) ordered.push(i);
    }
  }

  return ordered;
}

function buildProgramSection(
  boardName: string,
  parentIssueRef: string,
  cards: ProgramCard[],
  issueByCardIndex: Map<number, number>,
  order: number[],
): string {
  const lines: string[] = [
    PROGRAM_SECTION_START,
    "## Program Plan",
    `Generated from ${parentIssueRef} (${boardName}).`,
    "",
  ];

  order.forEach((cardIdx, orderIdx) => {
    const card = cards[cardIdx];
    const issueNumber = issueByCardIndex.get(cardIdx);
    if (!issueNumber) return;
    const depIssues = card.dependencyIndices
      .map((depIdx) => issueByCardIndex.get(depIdx))
      .filter((n): n is number => typeof n === "number")
      .map((n) => `#${n}`);

    lines.push(`### Epic ${orderIdx + 1}: ${card.title}`);
    lines.push(`- [ ] #${issueNumber}`);
    if (depIssues.length > 0) {
      lines.push(`- depends on: ${depIssues.join(", ")}`);
    }
    lines.push("");
  });

  lines.push(PROGRAM_SECTION_END);
  return lines.join("\n");
}

function upsertProgramSection(existingBody: string, section: string): string {
  const body = existingBody || "";
  const start = body.indexOf(PROGRAM_SECTION_START);
  const end = body.indexOf(PROGRAM_SECTION_END);

  if (start !== -1 && end !== -1 && end > start) {
    const before = body.slice(0, start).replace(/\s+$/g, "");
    const after = body.slice(end + PROGRAM_SECTION_END.length).replace(/^\s+/g, "");
    return [before, section, after].filter(Boolean).join("\n\n");
  }

  if (!body.trim()) return section;
  return `${body.replace(/\s+$/g, "")}\n\n${section}`;
}

function githubHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN || ""}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "WorkerMill-CLI",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function createGithubIssue(title: string, body: string): Promise<CreateIssueResult> {
  const repo = process.env.GITHUB_REPO;
  if (!repo) throw new Error("GITHUB_REPO is not set");
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: githubHeaders(),
    body: JSON.stringify({ title, body }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub issue create failed (${res.status}): ${txt}`);
  }

  const data = (await res.json()) as { number: number; html_url: string };
  return { number: data.number, url: data.html_url };
}

async function updateGithubIssueBody(issueRef: string, body: string): Promise<void> {
  const repo = process.env.GITHUB_REPO;
  if (!repo) throw new Error("GITHUB_REPO is not set");
  const issueNumber = extractGithubIssueNumber(issueRef);

  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    headers: githubHeaders(),
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub issue update failed (${res.status}): ${txt}`);
  }
}

function extractAcceptanceCriteria(description: string): string[] {
  const lines = description
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const bullets = lines
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);

  if (bullets.length > 0) return bullets;
  return ["Implementation matches epic scope and passes project quality gates."];
}

function buildChildIssueBody(parentIssueRef: string, card: ProgramCard, dependencyRefs: string[], cardIndex: number): string {
  const acceptanceCriteria = extractAcceptanceCriteria(card.description);
  const lines: string[] = [
    `<!-- WORKERMILL_PROGRAM_CARD index:${cardIndex + 1} -->`,
    `Parent issue: ${parentIssueRef}`,
    "",
    "## Objective",
    card.description.trim(),
    "",
    "## Acceptance Criteria",
    ...acceptanceCriteria.map((criterion) => `- [ ] ${criterion}`),
    "",
  ];

  if (card.labels.length > 0) {
    lines.push("## Labels");
    lines.push(card.labels.map((l) => `\`${l}\``).join(", "));
    lines.push("");
  }

  lines.push("## Dependencies");
  if (dependencyRefs.length > 0) {
    lines.push(`- Depends on: ${dependencyRefs.join(", ")}`);
  } else {
    lines.push("- None");
  }
  lines.push("");

  lines.push("## Delivery Notes");
  lines.push("- Built by `/orchestrate` decomposition.");
  lines.push("- Keep scope focused to one shippable epic increment.");
  return lines.join("\n");
}

export async function decomposeParentIssue(
  config: CliConfig,
  parent: ParentIssueData,
  onLog?: (msg: string) => void,
): Promise<ProgramDecomposition> {
  const { provider, model, host, contextLength, apiKey } = getProviderForPersona(config, "planner");

  // Set API key in env — the AI SDK reads it from the environment variable,
  // not from the model constructor.
  if (apiKey) {
    const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" };
    const envVar = envMap[provider] || "OPENAI_API_KEY";
    if (envVar) process.env[envVar] = apiKey;
  }

  const plannerModel = createModel(provider as AIProvider, model, host, contextLength);

  const repoContext = detectRepositoryContext();
  const repoContextText = buildRepositoryContextPrompt(repoContext);

  const prdContent = `# ${parent.title}\n\n${parent.body}`;
  const prompt =
    `You are decomposing work for an existing repository unless context explicitly proves greenfield.\n` +
    `Critical constraints:\n` +
    `- Prefer delta-only implementation (modify/extend existing code).\n` +
    `- Reuse existing framework, project structure, and test patterns.\n` +
    `- Do not propose scaffolding, bootstrap, or "foundation" rebuild unless required by missing essentials.\n\n` +
    `${repoContextText}\n\n` +
    `Decompose this PRD into implementation cards:\n\n${prdContent}`;
  const stream = streamText({
    model: plannerModel,
    system: SYSTEM_PROMPT_WITH_STORIES,
    prompt,
    maxOutputTokens: 128000,
    temperature: 0,
  });

  let streamed = "";
  for await (const chunk of stream.textStream) {
    streamed += chunk;
  }
  const finalText = (await stream.text) || streamed;

  onLog?.("Decomposer response received; validating plan...");

  const parsed = parseJsonObject(finalText);
  const validated = ProgramDecompositionSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Program decomposition parse failed: ${validated.error.issues[0]?.message || "invalid JSON shape"}`);
  }

  return {
    boardName: validated.data.boardName,
    cards: (() => {
      const normalized = normalizeDependencyIndices(validated.data.cards);
      validateExistingRepoDecomposition({ boardName: validated.data.boardName, cards: normalized }, repoContext);
      return normalized;
    })(),
  };
}

export async function materializeProgramSubIssues(
  config: CliConfig,
  parentIssueRef: string,
  parent: ParentIssueData,
  onLog?: (msg: string) => void,
  decompositionOverride?: ProgramDecomposition,
): Promise<{ epics: ProgramEpic[]; createdIssueKeys: string[] }> {
  const decomposition = decompositionOverride || await decomposeParentIssue(config, parent, onLog);

  const cards = decomposition.cards;
  const order = topologicalCardOrder(cards);
  const issueByCardIndex = new Map<number, number>();

  onLog?.(`Creating ${cards.length} child issue(s) from decomposition...`);

  for (const cardIdx of order) {
    const card = cards[cardIdx];
    const depRefs = card.dependencyIndices
      .map((dep) => issueByCardIndex.get(dep))
      .filter((n): n is number => typeof n === "number")
      .map((n) => `#${n}`);

    const issue = await createGithubIssue(
      card.title,
      buildChildIssueBody(parentIssueRef, card, depRefs, cardIdx),
    );
    issueByCardIndex.set(cardIdx, issue.number);
    onLog?.(`Created child issue #${issue.number}: ${card.title}`);
  }

  const section = buildProgramSection(
    decomposition.boardName,
    parentIssueRef,
    cards,
    issueByCardIndex,
    order,
  );

  const updatedParentBody = upsertProgramSection(parent.body || "", section);
  await updateGithubIssueBody(parentIssueRef, updatedParentBody);
  onLog?.(`Updated parent issue ${parentIssueRef} with generated child issue plan.`);

  const epics: ProgramEpic[] = order
    .map((cardIdx, i) => {
      const issueNo = issueByCardIndex.get(cardIdx);
      if (!issueNo) return null;
      return {
        title: `Epic ${i + 1}: ${cards[cardIdx].title}`,
        issueKeys: [`#${issueNo}`],
      };
    })
    .filter((epic): epic is ProgramEpic => epic !== null);

  const createdIssueKeys = epics.flatMap((e) => e.issueKeys);
  return { epics, createdIssueKeys };
}
