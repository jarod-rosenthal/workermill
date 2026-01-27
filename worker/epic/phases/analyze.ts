/**
 * Analyze Phase - Read codebase and produce authoritative implementation plan
 *
 * This phase:
 * 1. Explores the codebase to understand patterns and structure
 * 2. Produces implementation units (bounded work packages)
 * 3. Pre-selects relevant snippets for each unit
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import {
  AnalyzeOutputs,
  ImplementationUnit,
  RelevantSnippet,
  TokenUsage,
  PHASE_READ_BUDGETS,
} from "../phased-types.js";

interface AnalyzeResult extends AnalyzeOutputs {
  tokenUsage?: TokenUsage;
  readCount?: number;
}

const ANALYZE_SYSTEM_PROMPT = `You are an expert code analyst. Your job is to analyze a codebase and create an implementation plan.

You will receive:
1. Story requirements (title, scope, acceptance criteria)
2. Repository context

Your task is to produce an AUTHORITATIVE implementation plan by:
1. Reading relevant files to understand patterns and structure
2. Identifying which files need to be modified
3. Grouping coupled files into "implementation units"
4. Pre-selecting relevant code snippets for each unit

OUTPUT FORMAT (JSON):
{
  "existingPatterns": ["Pattern descriptions found in codebase"],
  "keyDecisions": ["Architectural decisions for this implementation"],
  "techConstraints": ["Technical constraints identified"],
  "testCommands": ["Commands to verify the implementation"],
  "implementationUnits": [
    {
      "index": 0,
      "name": "Human-readable unit name",
      "files": ["primary/files/to/modify.ts"],
      "goal": "What this unit accomplishes",
      "dependencies": [],
      "allowedTouchSet": ["files/allowed/to/edit.ts", "including/index.ts"],
      "relevantSnippets": [
        {
          "filePath": "path/to/example.ts",
          "content": "// File content here",
          "reason": "Example pattern to follow"
        }
      ],
      "estimatedTokens": 20000
    }
  ],
  "additionalFilesNeeded": ["Files that may need creation"],
  "estimatedTotalTokens": 50000
}

RULES:
- Group coupled files into the SAME unit (e.g., model + service + route for a feature)
- Order units by dependencies (earlier units should have no/fewer dependencies)
- Keep units focused - aim for 1-3 files per unit
- Pre-select snippets that show patterns to follow (max 200 lines each)
- allowedTouchSet should include index files and related exports
- Be conservative with token estimates

Use the read_file tool to explore the codebase. You have a budget of ${PHASE_READ_BUDGETS.analyze} file reads.`;

export async function runAnalyzePhase(
  client: Anthropic,
  model: string,
  contextPrompt: string,
  repoPath: string,
  tokenBudget: number
): Promise<AnalyzeResult> {
  let readCount = 0;
  const maxReads = PHASE_READ_BUDGETS.analyze;
  const filesRead: Map<string, string> = new Map();

  // Tool for reading files
  const tools: Anthropic.Tool[] = [
    {
      name: "read_file",
      description:
        "Read a file from the repository. Use this to explore patterns and structure.",
      input_schema: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description: "Relative path to the file from repo root",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "list_directory",
      description: "List files in a directory to understand structure.",
      input_schema: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description: "Relative path to directory from repo root",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "submit_analysis",
      description: "Submit the final analysis result.",
      input_schema: {
        type: "object" as const,
        properties: {
          existingPatterns: {
            type: "array",
            items: { type: "string" },
            description: "Patterns found in the codebase",
          },
          keyDecisions: {
            type: "array",
            items: { type: "string" },
            description: "Architectural decisions for implementation",
          },
          techConstraints: {
            type: "array",
            items: { type: "string" },
            description: "Technical constraints identified",
          },
          testCommands: {
            type: "array",
            items: { type: "string" },
            description: "Commands to verify implementation",
          },
          implementationUnits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "number" },
                name: { type: "string" },
                files: { type: "array", items: { type: "string" } },
                goal: { type: "string" },
                dependencies: { type: "array", items: { type: "number" } },
                allowedTouchSet: { type: "array", items: { type: "string" } },
                relevantSnippets: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      filePath: { type: "string" },
                      content: { type: "string" },
                      reason: { type: "string" },
                    },
                  },
                },
                estimatedTokens: { type: "number" },
              },
            },
            description: "Implementation units (bounded work packages)",
          },
          additionalFilesNeeded: {
            type: "array",
            items: { type: "string" },
            description: "New files that may need to be created",
          },
          estimatedTotalTokens: {
            type: "number",
            description: "Estimated total tokens for all units",
          },
        },
        required: [
          "existingPatterns",
          "keyDecisions",
          "techConstraints",
          "testCommands",
          "implementationUnits",
          "additionalFilesNeeded",
          "estimatedTotalTokens",
        ],
      },
    },
  ];

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `${contextPrompt}\n\nAnalyze the codebase and produce an implementation plan. Use read_file and list_directory to explore, then submit_analysis with your findings.`,
    },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let result: AnalyzeResult | null = null;

  // Agentic loop
  while (!result) {
    const response = await client.messages.create({
      model,
      max_tokens: Math.min(4096, tokenBudget),
      system: ANALYZE_SYSTEM_PROMPT,
      tools,
      messages,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    // Process response
    const assistantContent: Anthropic.ContentBlock[] = [];
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      assistantContent.push(block);

      if (block.type === "tool_use") {
        const toolName = block.name;
        const toolInput = block.input as Record<string, unknown>;

        let toolResult: string;

        if (toolName === "read_file") {
          if (readCount >= maxReads) {
            toolResult = `Read budget exceeded (${maxReads} files). Please work with files already read.`;
          } else {
            const filePath = toolInput.path as string;
            const fullPath = path.join(repoPath, filePath);
            try {
              if (fs.existsSync(fullPath)) {
                const content = fs.readFileSync(fullPath, "utf-8");
                const lines = content.split("\n");
                if (lines.length > 300) {
                  toolResult =
                    lines.slice(0, 300).join("\n") +
                    `\n\n... (truncated, ${lines.length - 300} more lines)`;
                } else {
                  toolResult = content;
                }
                filesRead.set(filePath, toolResult);
                readCount++;
              } else {
                toolResult = `File not found: ${filePath}`;
              }
            } catch (error) {
              toolResult = `Error reading file: ${error}`;
            }
          }
        } else if (toolName === "list_directory") {
          const dirPath = toolInput.path as string;
          const fullPath = path.join(repoPath, dirPath || ".");
          try {
            if (fs.existsSync(fullPath)) {
              const entries = fs.readdirSync(fullPath, { withFileTypes: true });
              const listing = entries
                .map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`)
                .join("\n");
              toolResult = listing || "(empty directory)";
            } else {
              toolResult = `Directory not found: ${dirPath}`;
            }
          } catch (error) {
            toolResult = `Error listing directory: ${error}`;
          }
        } else if (toolName === "submit_analysis") {
          // Final submission
          const input = toolInput as {
            existingPatterns: string[];
            keyDecisions: string[];
            techConstraints: string[];
            testCommands: string[];
            implementationUnits: ImplementationUnit[];
            additionalFilesNeeded: string[];
            estimatedTotalTokens: number;
          };

          // Enrich snippets with actual content from files we've read
          for (const unit of input.implementationUnits) {
            for (const snippet of unit.relevantSnippets) {
              if (!snippet.content && filesRead.has(snippet.filePath)) {
                snippet.content = filesRead.get(snippet.filePath)!;
              }
            }
          }

          result = {
            existingPatterns: input.existingPatterns,
            keyDecisions: input.keyDecisions,
            techConstraints: input.techConstraints,
            testCommands: input.testCommands || [
              "npm run typecheck",
              "npm run lint",
              "npm test",
            ],
            implementationUnits: input.implementationUnits,
            additionalFilesNeeded: input.additionalFilesNeeded,
            estimatedTotalTokens: input.estimatedTotalTokens,
            tokenUsage: {
              input: totalInputTokens,
              output: totalOutputTokens,
              total: totalInputTokens + totalOutputTokens,
            },
            readCount,
          };
          toolResult = "Analysis submitted successfully.";
        } else {
          toolResult = `Unknown tool: ${toolName}`;
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: toolResult,
        });
      }
    }

    // Add assistant message
    messages.push({ role: "assistant", content: assistantContent });

    // If there were tool uses, add results and continue
    if (toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults });
    }

    // Check for stop condition
    if (response.stop_reason === "end_turn" && !result) {
      // Model stopped without submitting - request submission
      messages.push({
        role: "user",
        content:
          "Please submit your analysis using the submit_analysis tool.",
      });
    }

    // Safety: prevent infinite loops
    if (messages.length > 50) {
      throw new Error("Analyze phase exceeded message limit");
    }
  }

  return result;
}
