import { spawn } from "child_process";
import { existsSync } from "fs";
import { ensureValidOAuthToken } from "./llm-backend.js";
import { logger } from "../utils/logger.js";
import type { QualityFeedback } from "../models/KbSpec.js";

const SCORING_RUBRIC = `You are a specification quality evaluator for AI coding agents. Score the following specification on 5 dimensions.

## Scoring Dimensions (total = 100 weighted)

### Completeness (weight: 30%)
Does the spec include these sections?
- Overview/deliverables
- Technical specification with version constraints
- Data model (database schema)
- Architecture (file structure, patterns)
- API specification (endpoints)
- Component specification (UI)
- Quality gates (lint, test, typecheck commands)
- Acceptance criteria
- Scope boundary ("DO NOT" section)
Score 0-100 based on coverage. Missing critical sections (scope boundary, version constraints) penalize heavily.

### Clarity (weight: 20%)
- Are requirements testable and unambiguous?
- No vague language ("should be fast", "nice UI", "good UX")
- Specific values instead of qualitative descriptions
- Clear input/output expectations
Score 0-100.

### Decomposability (weight: 20%)
- Can this be broken into independent stories?
- Are dependencies between components explicit?
- Are stories small enough for a single worker?
- Is execution order clear?
Score 0-100.

### Constraints (weight: 15%)
- Are dependency versions pinned (exact or semver range)?
- Is the tech stack specific (not "a modern framework")?
- Are "DO NOT" sections present and specific?
- Are scope boundaries clear?
Score 0-100.

### Testability (weight: 15%)
- Are acceptance criteria measurable (not subjective)?
- Are quality gate commands specified?
- Are test expectations concrete?
- Can a machine verify success?
Score 0-100.

## Response Format

Return ONLY valid JSON matching this schema:
{
  "overall": <weighted score 0-100>,
  "dimensions": {
    "completeness": { "score": <0-100>, "feedback": "<specific feedback>" },
    "clarity": { "score": <0-100>, "feedback": "<specific feedback>" },
    "decomposability": { "score": <0-100>, "feedback": "<specific feedback>" },
    "constraints": { "score": <0-100>, "feedback": "<specific feedback>" },
    "testability": { "score": <0-100>, "feedback": "<specific feedback>" }
  },
  "suggestions": [
    "<actionable suggestion 1>",
    "<actionable suggestion 2>",
    "<actionable suggestion 3>"
  ]
}

Return 3-5 suggestions, ordered by impact. Each suggestion must be actionable (tell the user exactly what to add or change).`;

/**
 * Score a spec via Claude CLI (local dev with OAuth) or Anthropic SDK (cloud with API key).
 * Follows the same auth pattern as prd-decomposer.ts.
 */
export async function scoreSpec(
  specContent: string,
  orgRequiredSections?: string[] | null,
): Promise<QualityFeedback> {
  let systemPrompt = SCORING_RUBRIC;
  if (orgRequiredSections?.length) {
    systemPrompt += `\n\n## Organization Required Sections\nThis organization requires these additional sections: ${orgRequiredSections.join(", ")}. Penalize completeness if missing.`;
  }

  const prompt = `${systemPrompt}\n\n---\n\nScore this specification:\n\n${specContent}`;

  // Use Claude CLI if available (local dev with OAuth), otherwise fall back to SDK
  const claudePath =
    process.env.CLAUDE_CLI_PATH || "/home/user/.local/bin/claude";
  const hasClaudeCli = existsSync(claudePath);

  let text: string;
  if (hasClaudeCli) {
    text = await callClaudeCli(claudePath, prompt);
  } else {
    text = await callAnthropicSdk(prompt, systemPrompt, specContent);
  }

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.error("Failed to parse scoring response", { text });
    throw new Error("Failed to parse quality score response");
  }

  const feedback = JSON.parse(jsonMatch[0]) as QualityFeedback;

  // Validate the weighted overall score
  const d = feedback.dimensions;
  const expectedOverall = Math.round(
    d.completeness.score * 0.3 +
      d.clarity.score * 0.2 +
      d.decomposability.score * 0.2 +
      d.constraints.score * 0.15 +
      d.testability.score * 0.15,
  );
  if (Math.abs(feedback.overall - expectedOverall) > 5) {
    feedback.overall = expectedOverall;
  }

  return feedback;
}

/** Call Claude CLI with OAuth — same pattern as ClaudeCliBackend in llm-backend.ts */
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
            `Claude CLI exited with code ${code}: ${stderr || fullText}`.substring(0, 500),
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
  systemPrompt: string,
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
    max_tokens: 2000,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Score this specification:\n\n${specContent}`,
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}
