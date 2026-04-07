import fs from "fs";
import path from "path";
import { applyEditToContent, type EditStatus } from "./edit-file.js";

export const name = "multi_edit_file";

export const description =
  "Apply multiple edits to a single file atomically. If any edit fails, no changes are written. Use for 3+ edits in the same file instead of repeated edit_file calls.";

export const parameters = {
  type: "object" as const,
  properties: {
    file_path: {
      type: "string" as const,
      description: "Path to the file to edit (absolute or relative to cwd)",
    },
    edits: {
      type: "array" as const,
      description: "Array of edits to apply in order",
      items: {
        type: "object" as const,
        properties: {
          old_string: {
            type: "string" as const,
            description:
              "The exact text to find and replace. Must match exactly including whitespace and indentation.",
          },
          new_string: {
            type: "string" as const,
            description:
              "The text to replace old_string with. Can be empty string to delete.",
          },
          replace_all: {
            type: "boolean" as const,
            description:
              "Replace all occurrences instead of requiring unique match (default: false)",
          },
        },
        required: ["old_string", "new_string"] as const,
      },
    },
  },
  required: ["file_path", "edits"] as const,
};

interface MultiEditParams {
  file_path: string;
  edits: Array<{
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  }>;
}

interface EditResultDetail {
  index: number;
  status: EditStatus;
  detail?: string;
}

interface MultiEditFileResult {
  success: boolean;
  file_path?: string;
  results?: EditResultDetail[];
  error?: string;
  linesBefore?: number;
  linesAfter?: number;
  linesDiff?: string;
}

export async function execute({
  file_path: filePath,
  edits,
}: MultiEditParams): Promise<MultiEditFileResult> {
  try {
    // Resolve to absolute path
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        error: `File not found: ${absolutePath}`,
      };
    }

    // Check if it's a file (not directory)
    const stats = fs.statSync(absolutePath);
    if (stats.isDirectory()) {
      return {
        success: false,
        error: `Path is a directory, not a file: ${absolutePath}`,
      };
    }

    // Read file content
    let content = fs.readFileSync(absolutePath, "utf8");
    const originalContent = content;
    const results: EditResultDetail[] = [];

    // Process edits in order, building up in-memory
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const result = applyEditToContent(
        content,
        edit.old_string,
        edit.new_string,
        edit.replace_all ?? false,
      );

      if (result.status === "applied") {
        // Success — update in-memory content for next edit
        content = result.newContent!;
        results.push({
          index: i,
          status: "applied",
        });
      } else if (result.status === "not_found") {
        // Failure — rollback atomically
        results.push({
          index: i,
          status: "not_found",
          detail: result.hint,
        });
        // Return without writing
        return {
          success: false,
          file_path: absolutePath,
          results,
          error: `Edit ${i} not found. No changes applied.`,
        };
      } else if (result.status === "ambiguous") {
        // Failure — rollback atomically
        results.push({
          index: i,
          status: "ambiguous",
          detail: result.hint,
        });
        // Return without writing
        return {
          success: false,
          file_path: absolutePath,
          results,
          error: `Edit ${i} is ambiguous (${result.occurrences} matches). No changes applied.`,
        };
      }
    }

    // All edits succeeded — write to file
    fs.writeFileSync(absolutePath, content, "utf8");

    // Calculate what changed
    const oldLines = originalContent.split("\n").length;
    const newLines = content.split("\n").length;
    const linesDiff = newLines - oldLines;

    return {
      success: true,
      file_path: absolutePath,
      results,
      linesBefore: oldLines,
      linesAfter: newLines,
      linesDiff: linesDiff > 0 ? `+${linesDiff}` : linesDiff.toString(),
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to edit file: ${(err as Error).message}`,
    };
  }
}
