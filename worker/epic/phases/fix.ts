/**
 * Fix Phase - Address specific issues from verification
 *
 * This phase:
 * 1. Receives issues from verify phase
 * 2. Fixes them one by one
 * 3. Always followed by another verify phase
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import {
  FixOutputs,
  VerifyIssue,
  TokenUsage,
  PHASE_READ_BUDGETS,
} from "../phased-types.js";

interface FixResult extends Omit<FixOutputs, "iterationNumber"> {
  tokenUsage?: TokenUsage;
  readCount?: number;
}

const FIX_SYSTEM_PROMPT = `You are an expert bug fixer. Your job is to fix specific issues identified during verification.

You will receive:
1. A list of issues to fix (type errors, test failures, lint errors, AC gaps)
2. Command logs showing the exact errors
3. Prior fix attempts (if any)

Your task is to:
1. Fix each issue systematically
2. Focus on the ROOT CAUSE, not symptoms
3. Avoid introducing new issues
4. Mark issues as addressed when fixed

RULES:
- Fix issues in order of importance (errors before warnings)
- If an issue seems unfixable, mark it as remaining
- Don't over-engineer - minimal targeted fixes
- If prior attempts didn't work, try a different approach`;

export async function runFixPhase(
  client: Anthropic,
  model: string,
  contextPrompt: string,
  repoPath: string,
  issues: VerifyIssue[],
  tokenBudget: number
): Promise<FixResult> {
  let readCount = 0;
  const maxReads = PHASE_READ_BUDGETS.fix;
  const issuesAddressed: string[] = [];
  const issuesRemaining: string[] = [];
  const filesModified: string[] = [];

  const tools: Anthropic.Tool[] = [
    {
      name: "read_file",
      description: "Read a file to understand the context.",
      input_schema: {
        type: "object" as const,
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
    {
      name: "edit_file",
      description: "Edit a file to fix an issue.",
      input_schema: {
        type: "object" as const,
        properties: {
          path: { type: "string" },
          old_content: { type: "string" },
          new_content: { type: "string" },
        },
        required: ["path", "old_content", "new_content"],
      },
    },
    {
      name: "write_file",
      description: "Completely rewrite a file if needed.",
      input_schema: {
        type: "object" as const,
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "run_command",
      description: "Run a quick command to test a fix.",
      input_schema: {
        type: "object" as const,
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
      },
    },
    {
      name: "mark_addressed",
      description: "Mark an issue as addressed.",
      input_schema: {
        type: "object" as const,
        properties: {
          issueDescription: { type: "string" },
          fixDescription: { type: "string" },
        },
        required: ["issueDescription", "fixDescription"],
      },
    },
    {
      name: "mark_remaining",
      description: "Mark an issue as unfixable in this iteration.",
      input_schema: {
        type: "object" as const,
        properties: {
          issueDescription: { type: "string" },
          reason: { type: "string" },
        },
        required: ["issueDescription", "reason"],
      },
    },
    {
      name: "complete_fix",
      description: "Complete the fix phase.",
      input_schema: {
        type: "object" as const,
        properties: {
          summary: { type: "string" },
        },
        required: ["summary"],
      },
    },
  ];

  // Format issues for the prompt
  const issuesList = issues
    .map((issue, i) => {
      let desc = `${i + 1}. [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.message}`;
      if (issue.file) desc += `\n   File: ${issue.file}${issue.line ? `:${issue.line}` : ""}`;
      if (issue.commandLog) desc += `\n   Log:\n   ${issue.commandLog.split("\n").join("\n   ")}`;
      return desc;
    })
    .join("\n\n");

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `${contextPrompt}

## Issues to Fix

${issuesList}

Fix each issue systematically. Use mark_addressed when fixed, mark_remaining if unfixable.`,
    },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let completed = false;

  while (!completed) {
    const response = await client.messages.create({
      model,
      max_tokens: Math.min(4096, tokenBudget),
      system: FIX_SYSTEM_PROMPT,
      tools,
      messages,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    const assistantContent: Anthropic.ContentBlock[] = [];
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      assistantContent.push(block);

      if (block.type === "tool_use") {
        const toolName = block.name;
        const toolInput = block.input as Record<string, unknown>;
        let toolResult: string;

        switch (toolName) {
          case "read_file": {
            if (readCount >= maxReads) {
              toolResult = `Read budget exceeded (${maxReads}).`;
            } else {
              const filePath = toolInput.path as string;
              const fullPath = path.join(repoPath, filePath);
              try {
                if (fs.existsSync(fullPath)) {
                  toolResult = fs.readFileSync(fullPath, "utf-8");
                  readCount++;
                } else {
                  toolResult = `File not found: ${filePath}`;
                }
              } catch (error) {
                toolResult = `Error: ${error}`;
              }
            }
            break;
          }

          case "edit_file": {
            const filePath = toolInput.path as string;
            const fullPath = path.join(repoPath, filePath);
            try {
              if (!fs.existsSync(fullPath)) {
                toolResult = `File not found: ${filePath}`;
              } else {
                let content = fs.readFileSync(fullPath, "utf-8");
                const oldContent = toolInput.old_content as string;
                const newContent = toolInput.new_content as string;
                if (!content.includes(oldContent)) {
                  toolResult = `old_content not found. Check exact whitespace/newlines.`;
                } else {
                  content = content.replace(oldContent, newContent);
                  fs.writeFileSync(fullPath, content);
                  if (!filesModified.includes(filePath)) {
                    filesModified.push(filePath);
                  }
                  toolResult = `Edited: ${filePath}`;
                }
              }
            } catch (error) {
              toolResult = `Error: ${error}`;
            }
            break;
          }

          case "write_file": {
            const filePath = toolInput.path as string;
            const fullPath = path.join(repoPath, filePath);
            try {
              const dir = path.dirname(fullPath);
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
              }
              fs.writeFileSync(fullPath, toolInput.content as string);
              if (!filesModified.includes(filePath)) {
                filesModified.push(filePath);
              }
              toolResult = `Written: ${filePath}`;
            } catch (error) {
              toolResult = `Error: ${error}`;
            }
            break;
          }

          case "run_command": {
            const command = toolInput.command as string;
            try {
              const output = require("child_process").execSync(command, {
                cwd: repoPath,
                encoding: "utf-8",
                timeout: 30000,
              });
              toolResult = output || "(no output)";
            } catch (error: unknown) {
              const execError = error as {
                status?: number;
                stdout?: string;
                stderr?: string;
              };
              toolResult = `Exit ${execError.status || 1}:\n${execError.stdout || ""}\n${execError.stderr || ""}`;
            }
            break;
          }

          case "mark_addressed": {
            const desc = `${toolInput.issueDescription}: ${toolInput.fixDescription}`;
            issuesAddressed.push(desc);
            toolResult = `Marked as addressed: ${toolInput.issueDescription}`;
            break;
          }

          case "mark_remaining": {
            const desc = `${toolInput.issueDescription}: ${toolInput.reason}`;
            issuesRemaining.push(desc);
            toolResult = `Marked as remaining: ${toolInput.issueDescription}`;
            break;
          }

          case "complete_fix": {
            completed = true;
            toolResult = "Fix phase complete.";
            break;
          }

          default:
            toolResult = `Unknown tool: ${toolName}`;
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: toolResult,
        });
      }
    }

    messages.push({ role: "assistant", content: assistantContent });

    if (toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults });
    }

    if (response.stop_reason === "end_turn" && !completed) {
      messages.push({
        role: "user",
        content: "Please complete the fix phase using complete_fix tool.",
      });
    }

    if (messages.length > 80) {
      throw new Error("Fix phase exceeded message limit");
    }
  }

  return {
    issuesAddressed,
    issuesRemaining,
    filesModified,
    tokenUsage: {
      input: totalInputTokens,
      output: totalOutputTokens,
      total: totalInputTokens + totalOutputTokens,
    },
    readCount,
  };
}
