/**
 * Integrate Phase - Coherence check after all implementation units
 *
 * This phase:
 * 1. Reviews all unit outputs for coherence
 * 2. Fixes import/export issues between units
 * 3. Updates index files as needed
 * 4. Resolves type inconsistencies
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import {
  IntegrateOutputs,
  ImplementOutputs,
  TokenUsage,
  PHASE_READ_BUDGETS,
} from "../phased-types.js";

interface IntegrateResult extends IntegrateOutputs {
  tokenUsage?: TokenUsage;
  readCount?: number;
}

const INTEGRATE_SYSTEM_PROMPT = `You are an expert code integrator. Your job is to ensure coherence across implementation units.

You will receive:
1. Story context
2. All unit outputs (files modified, exports added, imports needed)
3. Import/export map showing what was exported and what imports are needed

Your task is to:
1. Ensure all needed imports are properly added
2. Update index files to re-export new modules
3. Fix any type inconsistencies between units
4. Ensure the code compiles as a whole

Focus on integration issues - don't refactor or improve the code.`;

export async function runIntegratePhase(
  client: Anthropic,
  model: string,
  contextPrompt: string,
  repoPath: string,
  allUnitOutputs: ImplementOutputs[],
  tokenBudget: number
): Promise<IntegrateResult> {
  let readCount = 0;
  const maxReads = PHASE_READ_BUDGETS.integrate;
  const filesFixed: string[] = [];
  let importExportIssuesFixed = 0;
  let typeIssuesFixed = 0;
  const indexFilesUpdated: string[] = [];

  const tools: Anthropic.Tool[] = [
    {
      name: "read_file",
      description: "Read a file to check its current state.",
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
      description: "Edit a file to fix integration issues.",
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
      name: "append_to_file",
      description: "Append content to a file (e.g., adding exports to index).",
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
      name: "record_fix",
      description: "Record a fix you made.",
      input_schema: {
        type: "object" as const,
        properties: {
          fixType: {
            type: "string",
            enum: ["import_export", "type_issue", "index_file"],
          },
          description: { type: "string" },
        },
        required: ["fixType", "description"],
      },
    },
    {
      name: "complete_integration",
      description: "Mark integration as complete.",
      input_schema: {
        type: "object" as const,
        properties: {
          summary: { type: "string" },
          issuesFound: {
            type: "array",
            items: { type: "string" },
            description: "Issues found and fixed",
          },
        },
        required: ["summary", "issuesFound"],
      },
    },
  ];

  // Build import/export summary
  const exportsSummary = allUnitOutputs
    .flatMap((u) => u.exportsAdded)
    .map((e) => `- ${e.file}: export ${e.type} ${e.name}`)
    .join("\n");

  const importsSummary = allUnitOutputs
    .flatMap((u) => u.importsNeeded)
    .map((i) => `- ${i.file} needs: import { ${i.name} } from "${i.from}"`)
    .join("\n");

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `${contextPrompt}

## Exports Added
${exportsSummary || "(none)"}

## Imports Needed
${importsSummary || "(none)"}

Check that all imports are properly added and index files are updated. Focus on integration only.`,
    },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let completed = false;

  while (!completed) {
    const response = await client.messages.create({
      model,
      max_tokens: Math.min(4096, tokenBudget),
      system: INTEGRATE_SYSTEM_PROMPT,
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
                  toolResult = `old_content not found in file.`;
                } else {
                  content = content.replace(oldContent, newContent);
                  fs.writeFileSync(fullPath, content);
                  if (!filesFixed.includes(filePath)) {
                    filesFixed.push(filePath);
                  }
                  toolResult = `Edited: ${filePath}`;
                }
              }
            } catch (error) {
              toolResult = `Error: ${error}`;
            }
            break;
          }

          case "append_to_file": {
            const filePath = toolInput.path as string;
            const fullPath = path.join(repoPath, filePath);
            try {
              let content = "";
              if (fs.existsSync(fullPath)) {
                content = fs.readFileSync(fullPath, "utf-8");
              }
              content += "\n" + (toolInput.content as string);
              fs.writeFileSync(fullPath, content);
              if (!filesFixed.includes(filePath)) {
                filesFixed.push(filePath);
              }
              if (filePath.includes("index")) {
                indexFilesUpdated.push(filePath);
              }
              toolResult = `Appended to: ${filePath}`;
            } catch (error) {
              toolResult = `Error: ${error}`;
            }
            break;
          }

          case "record_fix": {
            const fixType = toolInput.fixType as string;
            if (fixType === "import_export") {
              importExportIssuesFixed++;
            } else if (fixType === "type_issue") {
              typeIssuesFixed++;
            }
            toolResult = `Fix recorded: ${toolInput.description}`;
            break;
          }

          case "complete_integration": {
            completed = true;
            toolResult = "Integration complete.";
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
      // Check if there's nothing to do
      if (allUnitOutputs.every((u) => u.importsNeeded.length === 0)) {
        completed = true;
      } else {
        messages.push({
          role: "user",
          content: "Please complete integration using complete_integration tool.",
        });
      }
    }

    if (messages.length > 50) {
      throw new Error("Integrate phase exceeded message limit");
    }
  }

  return {
    filesFixed,
    importExportIssuesFixed,
    typeIssuesFixed,
    indexFilesUpdated,
    tokenUsage: {
      input: totalInputTokens,
      output: totalOutputTokens,
      total: totalInputTokens + totalOutputTokens,
    },
    readCount,
  };
}
