/**
 * Implement Phase - Modify files for a specific implementation unit
 *
 * This phase:
 * 1. Receives pre-injected context (no re-reading basics)
 * 2. Modifies files within the allowedTouchSet
 * 3. Reports exports/imports for integration phase
 * 4. Can request plan updates if needed
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import {
  ImplementOutputs,
  ImplementationUnit,
  TokenUsage,
  PlanUpdateRequest,
  PHASE_READ_BUDGETS,
} from "../phased-types.js";

interface ImplementResult extends ImplementOutputs {
  tokenUsage?: TokenUsage;
  readCount?: number;
}

const IMPLEMENT_SYSTEM_PROMPT = `You are an expert code implementer. Your job is to implement changes for a specific unit of work.

You will receive:
1. Story requirements and context
2. Unit-specific context (target files, allowed files, pre-loaded snippets)
3. Prior unit decisions

Your task is to:
1. Implement the changes for THIS unit only
2. Stay within the allowedTouchSet (files you may edit)
3. Follow patterns shown in pre-loaded snippets
4. Report exports you add and imports you need

RULES:
- ONLY modify files in the allowedTouchSet
- Follow existing patterns from pre-loaded snippets
- If the plan seems wrong, use request_plan_update instead of diverging silently
- Report all exports added (for integration phase)
- Report imports needed from other files (for integration phase)

Use tools to read additional files (if needed) and write your changes.`;

export async function runImplementPhase(
  client: Anthropic,
  model: string,
  contextPrompt: string,
  repoPath: string,
  unit: ImplementationUnit,
  tokenBudget: number
): Promise<ImplementResult> {
  let readCount = 0;
  const maxReads = PHASE_READ_BUDGETS.implement;
  const filesModified: string[] = [];
  const filesCreated: string[] = [];
  const decisions: string[] = [];
  const exportsAdded: Array<{ file: string; name: string; type: string }> = [];
  const importsNeeded: Array<{ file: string; from: string; name: string }> = [];
  let planUpdateRequest: PlanUpdateRequest | undefined;

  const tools: Anthropic.Tool[] = [
    {
      name: "read_file",
      description: "Read a file (beyond pre-injected content). Budget limited.",
      input_schema: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "Relative path from repo root" },
        },
        required: ["path"],
      },
    },
    {
      name: "write_file",
      description: "Write or overwrite a file. Must be in allowedTouchSet.",
      input_schema: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "Relative path from repo root" },
          content: { type: "string", description: "Full file content" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "edit_file",
      description: "Edit a specific section of a file. Must be in allowedTouchSet.",
      input_schema: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "Relative path from repo root" },
          old_content: { type: "string", description: "Content to replace" },
          new_content: { type: "string", description: "Replacement content" },
        },
        required: ["path", "old_content", "new_content"],
      },
    },
    {
      name: "record_decision",
      description: "Record an architectural decision for sibling units.",
      input_schema: {
        type: "object" as const,
        properties: {
          decision: {
            type: "string",
            description: "Decision made (e.g., 'Used JWT for auth tokens')",
          },
        },
        required: ["decision"],
      },
    },
    {
      name: "record_export",
      description: "Record an export you added (for integration phase).",
      input_schema: {
        type: "object" as const,
        properties: {
          file: { type: "string", description: "File containing the export" },
          name: { type: "string", description: "Export name" },
          exportType: {
            type: "string",
            description: "Type: function, class, interface, type, const",
          },
        },
        required: ["file", "name", "exportType"],
      },
    },
    {
      name: "record_import_needed",
      description: "Record an import you need (for integration phase to resolve).",
      input_schema: {
        type: "object" as const,
        properties: {
          file: { type: "string", description: "File that needs the import" },
          from: { type: "string", description: "Module to import from" },
          name: { type: "string", description: "Import name" },
        },
        required: ["file", "from", "name"],
      },
    },
    {
      name: "request_plan_update",
      description: "Request a change to the implementation plan if it seems wrong.",
      input_schema: {
        type: "object" as const,
        properties: {
          reason: { type: "string", description: "Why the plan needs to change" },
          suggestedNewFiles: {
            type: "array",
            items: { type: "string" },
            description: "Files that should be added to the plan",
          },
          suggestedRemovals: {
            type: "array",
            items: { type: "string" },
            description: "Files that don't need changes",
          },
          risks: {
            type: "array",
            items: { type: "string" },
            description: "Risks of this change",
          },
          severity: {
            type: "string",
            enum: ["minor", "major"],
            description: "Minor: auto-approve. Major: needs review.",
          },
        },
        required: ["reason", "suggestedNewFiles", "suggestedRemovals", "risks", "severity"],
      },
    },
    {
      name: "complete_unit",
      description: "Mark this unit as complete.",
      input_schema: {
        type: "object" as const,
        properties: {
          summary: {
            type: "string",
            description: "Brief summary of what was implemented",
          },
        },
        required: ["summary"],
      },
    },
  ];

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `${contextPrompt}\n\nImplement the changes for Unit ${unit.index}: "${unit.name}"\n\nGoal: ${unit.goal}\n\nTarget files: ${unit.files.join(", ")}\nAllowed files: ${unit.allowedTouchSet.join(", ")}`,
    },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let completed = false;

  while (!completed) {
    const response = await client.messages.create({
      model,
      max_tokens: Math.min(4096, tokenBudget),
      system: IMPLEMENT_SYSTEM_PROMPT,
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
              toolResult = `Read budget exceeded (${maxReads}). Work with pre-injected content.`;
            } else {
              const filePath = toolInput.path as string;
              const fullPath = path.join(repoPath, filePath);
              try {
                if (fs.existsSync(fullPath)) {
                  const content = fs.readFileSync(fullPath, "utf-8");
                  toolResult = content;
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

          case "write_file": {
            const filePath = toolInput.path as string;
            if (!unit.allowedTouchSet.includes(filePath)) {
              toolResult = `ERROR: ${filePath} not in allowedTouchSet. Allowed: ${unit.allowedTouchSet.join(", ")}`;
            } else {
              const fullPath = path.join(repoPath, filePath);
              const isNew = !fs.existsSync(fullPath);
              try {
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                  fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(fullPath, toolInput.content as string);
                if (isNew) {
                  filesCreated.push(filePath);
                } else if (!filesModified.includes(filePath)) {
                  filesModified.push(filePath);
                }
                toolResult = `File ${isNew ? "created" : "written"}: ${filePath}`;
              } catch (error) {
                toolResult = `Error writing: ${error}`;
              }
            }
            break;
          }

          case "edit_file": {
            const filePath = toolInput.path as string;
            if (!unit.allowedTouchSet.includes(filePath)) {
              toolResult = `ERROR: ${filePath} not in allowedTouchSet.`;
            } else {
              const fullPath = path.join(repoPath, filePath);
              try {
                if (!fs.existsSync(fullPath)) {
                  toolResult = `File not found: ${filePath}`;
                } else {
                  let content = fs.readFileSync(fullPath, "utf-8");
                  const oldContent = toolInput.old_content as string;
                  const newContent = toolInput.new_content as string;
                  if (!content.includes(oldContent)) {
                    toolResult = `old_content not found in file. Check exact whitespace.`;
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
            }
            break;
          }

          case "record_decision": {
            const decision = toolInput.decision as string;
            decisions.push(decision);
            toolResult = `Decision recorded: ${decision}`;
            break;
          }

          case "record_export": {
            exportsAdded.push({
              file: toolInput.file as string,
              name: toolInput.name as string,
              type: toolInput.exportType as string,
            });
            toolResult = `Export recorded: ${toolInput.name} from ${toolInput.file}`;
            break;
          }

          case "record_import_needed": {
            importsNeeded.push({
              file: toolInput.file as string,
              from: toolInput.from as string,
              name: toolInput.name as string,
            });
            toolResult = `Import needed recorded: ${toolInput.name} in ${toolInput.file}`;
            break;
          }

          case "request_plan_update": {
            planUpdateRequest = {
              reason: toolInput.reason as string,
              suggestedNewFiles: toolInput.suggestedNewFiles as string[],
              suggestedRemovals: toolInput.suggestedRemovals as string[],
              risks: toolInput.risks as string[],
              severity: toolInput.severity as "minor" | "major",
            };
            toolResult = `Plan update requested (${planUpdateRequest.severity}): ${planUpdateRequest.reason}`;
            break;
          }

          case "complete_unit": {
            const summary = toolInput.summary as string;
            decisions.push(`Unit ${unit.index} completed: ${summary}`);
            completed = true;
            toolResult = "Unit marked complete.";
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
        content: "Please complete the unit using complete_unit tool.",
      });
    }

    if (messages.length > 100) {
      throw new Error("Implement phase exceeded message limit");
    }
  }

  return {
    unitIndex: unit.index,
    filesModified,
    filesCreated,
    decisions,
    exportsAdded,
    importsNeeded,
    planUpdateRequest,
    tokenUsage: {
      input: totalInputTokens,
      output: totalOutputTokens,
      total: totalInputTokens + totalOutputTokens,
    },
    readCount,
  };
}
