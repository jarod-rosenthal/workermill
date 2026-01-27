/**
 * Verify Phase - Run tests, type-check, lint, and validate acceptance criteria
 *
 * This phase:
 * 1. Runs verification commands (typecheck, lint, test)
 * 2. Checks acceptance criteria
 * 3. Reports issues for the fix phase
 */

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  VerifyOutputs,
  VerifyIssue,
  CommandOutput,
  AcceptanceCriteriaResult,
  TokenUsage,
  PHASE_READ_BUDGETS,
} from "../phased-types.js";

interface VerifyResult extends VerifyOutputs {
  tokenUsage?: TokenUsage;
  readCount?: number;
}

const VERIFY_SYSTEM_PROMPT = `You are a code verification expert. Your job is to verify that the implementation is correct.

You will receive:
1. Commands to run (typecheck, lint, test)
2. Acceptance criteria to validate

Your task is to:
1. Run each verification command
2. Analyze the output for errors
3. Check each acceptance criterion
4. Report any issues found

Be thorough but focus on actual errors, not warnings (unless they indicate real problems).`;

export async function runVerifyPhase(
  client: Anthropic,
  model: string,
  contextPrompt: string,
  repoPath: string,
  testCommands: string[],
  acceptanceCriteria: string[],
  tokenBudget: number
): Promise<VerifyResult> {
  let readCount = 0;
  const maxReads = PHASE_READ_BUDGETS.verify;
  const issues: VerifyIssue[] = [];
  const commandOutputs: CommandOutput[] = [];
  let typeCheckPassed = true;
  let lintPassed = true;
  const acResults: AcceptanceCriteriaResult[] = [];

  // Default commands if none provided
  const commands =
    testCommands.length > 0
      ? testCommands
      : ["npm run typecheck", "npm run lint", "npm test"];

  const tools: Anthropic.Tool[] = [
    {
      name: "run_command",
      description: "Run a verification command.",
      input_schema: {
        type: "object" as const,
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
      },
    },
    {
      name: "read_file",
      description: "Read a file to check implementation.",
      input_schema: {
        type: "object" as const,
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
    {
      name: "record_issue",
      description: "Record an issue found during verification.",
      input_schema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            enum: ["test_failure", "type_error", "lint_error", "acceptance_gap"],
          },
          file: { type: "string", description: "File with the issue (optional)" },
          line: { type: "number", description: "Line number (optional)" },
          message: { type: "string" },
          severity: { type: "string", enum: ["error", "warning"] },
          commandLog: {
            type: "string",
            description: "Relevant command output excerpt",
          },
        },
        required: ["type", "message", "severity"],
      },
    },
    {
      name: "record_ac_result",
      description: "Record whether an acceptance criterion was met.",
      input_schema: {
        type: "object" as const,
        properties: {
          criterion: { type: "string" },
          met: { type: "boolean" },
          evidence: { type: "string" },
        },
        required: ["criterion", "met", "evidence"],
      },
    },
    {
      name: "complete_verification",
      description: "Complete the verification phase.",
      input_schema: {
        type: "object" as const,
        properties: {
          passed: { type: "boolean" },
          summary: { type: "string" },
        },
        required: ["passed", "summary"],
      },
    },
  ];

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `${contextPrompt}

***REMOVED******REMOVED*** Commands to Run
${commands.map((c) => `- \`${c}\``).join("\n")}

***REMOVED******REMOVED*** Acceptance Criteria to Validate
${acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join("\n")}

Run each command and check each criterion. Record issues and AC results.`,
    },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let completed = false;
  let overallPassed = true;

  while (!completed) {
    const response = await client.messages.create({
      model,
      max_tokens: Math.min(4096, tokenBudget),
      system: VERIFY_SYSTEM_PROMPT,
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
          case "run_command": {
            const command = toolInput.command as string;
            const startTime = Date.now();
            let exitCode = 0;
            let output = "";

            try {
              output = execSync(command, {
                cwd: repoPath,
                encoding: "utf-8",
                timeout: 120000, // 2 min timeout
                maxBuffer: 1024 * 1024 * 10, // 10MB
              });
            } catch (error: unknown) {
              const execError = error as {
                status?: number;
                stdout?: string;
                stderr?: string;
              };
              exitCode = execError.status || 1;
              output =
                (execError.stdout || "") + "\n" + (execError.stderr || "");

              // Track failures
              if (command.includes("typecheck") || command.includes("tsc")) {
                typeCheckPassed = false;
              }
              if (command.includes("lint") || command.includes("eslint")) {
                lintPassed = false;
              }
            }

            const durationMs = Date.now() - startTime;

            // Truncate output for context
            const lines = output.split("\n");
            let truncatedLog = output;
            if (lines.length > 100) {
              // Keep first 50 and last 50 lines
              truncatedLog =
                lines.slice(0, 50).join("\n") +
                `\n\n... (${lines.length - 100} lines omitted) ...\n\n` +
                lines.slice(-50).join("\n");
            }

            commandOutputs.push({
              command,
              exitCode,
              truncatedLog,
              durationMs,
            });

            if (exitCode !== 0) {
              overallPassed = false;
            }

            toolResult = `Exit code: ${exitCode}\nDuration: ${durationMs}ms\n\n${truncatedLog}`;
            break;
          }

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

          case "record_issue": {
            const issue: VerifyIssue = {
              type: toolInput.type as VerifyIssue["type"],
              message: toolInput.message as string,
              severity: toolInput.severity as "error" | "warning",
            };
            if (toolInput.file) issue.file = toolInput.file as string;
            if (toolInput.line) issue.line = toolInput.line as number;
            if (toolInput.commandLog)
              issue.commandLog = toolInput.commandLog as string;

            issues.push(issue);
            if (issue.severity === "error") {
              overallPassed = false;
            }
            toolResult = `Issue recorded: ${issue.type} - ${issue.message}`;
            break;
          }

          case "record_ac_result": {
            const result: AcceptanceCriteriaResult = {
              criterion: toolInput.criterion as string,
              met: toolInput.met as boolean,
              evidence: toolInput.evidence as string,
            };
            acResults.push(result);
            if (!result.met) {
              overallPassed = false;
              issues.push({
                type: "acceptance_gap",
                message: `AC not met: ${result.criterion}`,
                severity: "error",
              });
            }
            toolResult = `AC recorded: ${result.met ? "✓" : "✗"} ${result.criterion}`;
            break;
          }

          case "complete_verification": {
            overallPassed = toolInput.passed as boolean;
            completed = true;
            toolResult = "Verification complete.";
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
        content:
          "Please complete verification using complete_verification tool.",
      });
    }

    if (messages.length > 50) {
      throw new Error("Verify phase exceeded message limit");
    }
  }

  // Parse test results from command outputs if available
  let testResults: { passed: number; failed: number; skipped: number } | undefined;
  for (const cmd of commandOutputs) {
    if (cmd.command.includes("test") || cmd.command.includes("jest")) {
      // Try to parse Jest-style output
      const passMatch = cmd.truncatedLog.match(/(\d+) passed/);
      const failMatch = cmd.truncatedLog.match(/(\d+) failed/);
      const skipMatch = cmd.truncatedLog.match(/(\d+) skipped/);
      if (passMatch || failMatch) {
        testResults = {
          passed: passMatch ? parseInt(passMatch[1]) : 0,
          failed: failMatch ? parseInt(failMatch[1]) : 0,
          skipped: skipMatch ? parseInt(skipMatch[1]) : 0,
        };
      }
    }
  }

  return {
    passed: overallPassed,
    issues,
    commandOutputs,
    testResults,
    typeCheckPassed,
    lintPassed,
    acceptanceCriteriaResults: acResults,
    tokenUsage: {
      input: totalInputTokens,
      output: totalOutputTokens,
      total: totalInputTokens + totalOutputTokens,
    },
    readCount,
  };
}
