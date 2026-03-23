/**
 * Spec Improver Service
 *
 * Rewrites a spec using critic feedback, target repo context, and current web knowledge.
 * Called after scoring to help users improve their specs before decomposition.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { ensureValidOAuthToken } from "./llm-backend.js";
import { logger } from "../utils/logger.js";
import type { QualityFeedback } from "../models/KbSpec.js";

export interface RepoContext {
  dependencies: string; // package.json / requirements.txt content
  fileTree: string; // top-level file listing
  readme: string; // README excerpt (first 2000 chars)
}

const IMPROVE_PROMPT = `You are a specification writer for AI coding agents. Your job is to rewrite and improve a specification based on quality feedback from a critic.

## Instructions
- Rewrite the specification to address ALL feedback and suggestions
- Preserve the user's original intent and requirements
- Add missing sections that were flagged
- Make vague requirements specific and testable
- Pin dependency versions where missing
- Add explicit scope boundaries and "DO NOT" sections if missing
- Add quality gate commands (lint, test, typecheck) if missing
- Make acceptance criteria measurable and machine-verifiable
- Keep the same general structure but enhance every section

## Output
Return ONLY the improved specification text. No preamble, no explanation — just the spec.`;

export async function improveSpec(
  specContent: string,
  qualityFeedback: QualityFeedback,
  repoContext: RepoContext | null,
  webSearchResults: string[],
): Promise<string> {
  const d = qualityFeedback.dimensions;

  let prompt = `${IMPROVE_PROMPT}\n\n---\n\n## Quality Feedback\n\n`;
  prompt += `**Overall Score:** ${qualityFeedback.overall}/100\n\n`;
  prompt += `### Dimension Scores\n`;
  prompt += `- **Completeness** (${d.completeness.score}/100): ${d.completeness.feedback}\n`;
  prompt += `- **Clarity** (${d.clarity.score}/100): ${d.clarity.feedback}\n`;
  prompt += `- **Decomposability** (${d.decomposability.score}/100): ${d.decomposability.feedback}\n`;
  prompt += `- **Constraints** (${d.constraints.score}/100): ${d.constraints.feedback}\n`;
  prompt += `- **Testability** (${d.testability.score}/100): ${d.testability.feedback}\n\n`;

  prompt += `### Suggestions\n`;
  for (const suggestion of qualityFeedback.suggestions) {
    prompt += `- ${suggestion}\n`;
  }

  if (repoContext) {
    prompt += `\n\n## Target Repository Context\n\n`;
    prompt += `### Dependencies\n\`\`\`\n${repoContext.dependencies}\n\`\`\`\n\n`;
    prompt += `### File Structure\n\`\`\`\n${repoContext.fileTree}\n\`\`\`\n\n`;
    if (repoContext.readme) {
      prompt += `### README Excerpt\n${repoContext.readme}\n\n`;
    }
  }

  if (webSearchResults.length > 0) {
    prompt += `\n\n## Current Technology Knowledge\n`;
    for (const result of webSearchResults) {
      prompt += `- ${result}\n`;
    }
  }

  prompt += `\n\n---\n\n## Original Specification to Improve\n\n${specContent}`;

  // Use Claude CLI if available (local dev with OAuth), otherwise fall back to SDK
  const claudePath =
    process.env.CLAUDE_CLI_PATH || "/home/user/.local/bin/claude";
  const hasClaudeCli = existsSync(claudePath);

  let text: string;
  if (hasClaudeCli) {
    text = await callClaudeCli(claudePath, prompt);
  } else {
    text = await callAnthropicSdk(prompt, specContent);
  }

  return text.trim();
}

/**
 * Gather context from the target GitHub repo to help the LLM write a better spec.
 */
export async function gatherRepoContext(
  githubRepo: string,
  githubToken: string,
): Promise<RepoContext | null> {
  const headers: Record<string, string> = {
    Authorization: `token ${githubToken}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "workermill-spec-improver",
  };

  try {
    // Fetch dependency file (try package.json, requirements.txt, go.mod)
    let dependencies = "";
    for (const depFile of ["package.json", "requirements.txt", "go.mod"]) {
      try {
        const resp = await fetch(
          `https://api.github.com/repos/${githubRepo}/contents/${depFile}`,
          { headers },
        );
        if (resp.ok) {
          const data = (await resp.json()) as { content?: string };
          if (data.content) {
            dependencies = Buffer.from(data.content, "base64").toString(
              "utf-8",
            );
            break;
          }
        }
      } catch (err) {
        console.error("[spec-improver] dependency file fetch failed:", err instanceof Error ? err.message : err);
      }
    }

    // Fetch repo tree (top 2 levels)
    let fileTree = "";
    try {
      const treeResp = await fetch(
        `https://api.github.com/repos/${githubRepo}/git/trees/HEAD?recursive=false`,
        { headers },
      );
      if (treeResp.ok) {
        const treeData = (await treeResp.json()) as {
          tree: Array<{ path: string; type: string }>;
        };
        const paths = treeData.tree
          .filter(
            (item) =>
              item.path.split("/").length <= 2 &&
              !item.path.startsWith("."),
          )
          .map((item) =>
            item.type === "tree" ? `${item.path}/` : item.path,
          );
        fileTree = paths.join("\n");
      }
    } catch (err) {
      console.error("[spec-improver] repo tree fetch failed:", err instanceof Error ? err.message : err);
    }

    // Fetch README
    let readme = "";
    try {
      const readmeResp = await fetch(
        `https://api.github.com/repos/${githubRepo}/readme`,
        { headers },
      );
      if (readmeResp.ok) {
        const readmeData = (await readmeResp.json()) as { content?: string };
        if (readmeData.content) {
          const full = Buffer.from(readmeData.content, "base64").toString(
            "utf-8",
          );
          readme = full.substring(0, 2000);
        }
      }
    } catch (err) {
      console.error("[spec-improver] README fetch failed:", err instanceof Error ? err.message : err);
    }

    // If we got nothing, return null
    if (!dependencies && !fileTree && !readme) {
      return null;
    }

    return { dependencies, fileTree, readme };
  } catch (err) {
    logger.warn("Failed to gather repo context", {
      githubRepo,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Search for current knowledge about technologies mentioned in the spec.
 * Best-effort — returns empty array if search fails.
 */
export async function searchCurrentKnowledge(
  specContent: string,
): Promise<string[]> {
  // Common technology patterns to look for
  const techPatterns = [
    "React",
    "Next.js",
    "Vue",
    "Nuxt",
    "Angular",
    "Svelte",
    "Django",
    "FastAPI",
    "Flask",
    "Express",
    "NestJS",
    "Prisma",
    "TypeORM",
    "Drizzle",
    "Tailwind",
    "PostgreSQL",
    "MongoDB",
    "Redis",
    "Docker",
    "Kubernetes",
    "Terraform",
    "Supabase",
    "Firebase",
    "Stripe",
    "tRPC",
    "GraphQL",
    "Remix",
    "Astro",
    "Vite",
    "Bun",
    "Deno",
    "Rust",
    "Go",
    "Python",
    "TypeScript",
  ];

  const contentLower = specContent.toLowerCase();
  const found = techPatterns.filter((tech) =>
    contentLower.includes(tech.toLowerCase()),
  );

  // Limit to 5 technologies
  const toSearch = found.slice(0, 5);
  if (toSearch.length === 0) {
    return [];
  }

  const results: string[] = [];

  for (const tech of toSearch) {
    try {
      const query = `${tech} latest version 2025`;
      const resp = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (resp.ok) {
        const data = (await resp.json()) as {
          Abstract?: string;
          AbstractText?: string;
          RelatedTopics?: Array<{ Text?: string }>;
        };
        if (data.AbstractText) {
          results.push(`${tech}: ${data.AbstractText}`);
        } else if (
          data.RelatedTopics &&
          data.RelatedTopics.length > 0 &&
          data.RelatedTopics[0].Text
        ) {
          results.push(`${tech}: ${data.RelatedTopics[0].Text}`);
        } else {
          // No useful result — add the query as context so LLM knows to check
          results.push(
            `${tech}: Check for latest version and breaking changes`,
          );
        }
      }
    } catch (err) {
      console.error("[spec-improver] tech research fetch failed:", err instanceof Error ? err.message : err);
      results.push(
        `${tech}: Check for latest version and breaking changes`,
      );
    }
  }

  return results;
}

/** Call Claude CLI with OAuth — same pattern as spec-scorer.ts */
async function callClaudeCli(
  claudePath: string,
  prompt: string,
): Promise<string> {
  await ensureValidOAuthToken();

  return new Promise((resolve, reject) => {
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;

    const claude = spawn(
      claudePath,
      [
        "--print",
        "--verbose",
        "--output-format",
        "stream-json",
        "--model",
        "claude-sonnet-4-6",
        "--permission-mode",
        "bypassPermissions",
        "--strict-mcp-config",
      ],
      { env: cleanEnv, stdio: ["pipe", "pipe", "pipe"] },
    );

    claude.stdin.write(prompt);
    claude.stdin.end();

    let lineBuffer = "";
    let resultText = "";
    let fullText = "";
    let stderr = "";

    claude.stdout.on("data", (data: Buffer) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === "assistant" && event.message?.content) {
            const content = event.message.content;
            if (typeof content === "string") {
              fullText += content;
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "text" && block.text) fullText += block.text;
              }
            }
          } else if (
            event.type === "content_block_delta" &&
            event.delta?.text
          ) {
            fullText += event.delta.text;
          } else if (event.type === "result" && event.result) {
            resultText =
              typeof event.result === "string" ? event.result : "";
          }
        } catch {
          fullText += trimmed + "\n";
        }
      }
    });

    claude.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    claude.on("close", (code) => {
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer.trim());
          if (event.type === "result" && event.result) {
            resultText =
              typeof event.result === "string" ? event.result : "";
          }
        } catch {
          fullText += lineBuffer;
        }
      }

      if (code !== 0) {
        reject(
          new Error(
            `Claude CLI exited with code ${code}: ${stderr || fullText}`.substring(
              0,
              500,
            ),
          ),
        );
        return;
      }
      resolve(resultText || fullText);
    });

    claude.on("error", (err) => {
      reject(err);
    });
  });
}

/** Fall back to Anthropic SDK for cloud/production (requires ANTHROPIC_API_KEY) */
async function callAnthropicSdk(
  _prompt: string,
  specContent: string,
): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No ANTHROPIC_API_KEY configured. Set it in environment or use Claude CLI locally.",
    );
  }

  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    system: IMPROVE_PROMPT,
    messages: [
      {
        role: "user",
        content: _prompt,
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}
