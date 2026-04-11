import fs from "fs";
import path from "path";

export const name = "edit_file";

export const description =
  "Edit a file by finding and replacing text. The old_string must be unique in the file (or use replaceAll for multiple occurrences). Use this instead of write_file when making targeted changes to existing files. Prefer multi_edit_file for 3+ edits in the same file.";

export const parameters = {
  type: "object" as const,
  properties: {
    path: {
      type: "string" as const,
      description: "Path to the file to edit (absolute or relative to cwd)",
    },
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
    replaceAll: {
      type: "boolean" as const,
      description:
        "Replace all occurrences instead of requiring unique match (default: false)",
    },
  },
  required: ["path", "old_string", "new_string"] as const,
};

interface EditFileParams {
  path: string;
  old_string: string;
  new_string: string;
  replaceAll?: boolean;
}

interface EditFileResult {
  success: boolean;
  path?: string;
  replacements?: number;
  linesBefore?: number;
  linesAfter?: number;
  linesDiff?: string;
  error?: string;
  hint?: string;
  filePreview?: string;
  occurrences?: number;
}

// Shared type for edit result status
export type EditStatus = "applied" | "not_found" | "ambiguous";

export interface EditResult {
  status: EditStatus;
  newContent?: string;
  occurrences?: number;
  hint?: string;
}

/**
 * Apply a single edit operation to content. Performs exact-match checking
 * and returns structured results distinguishing between not_found and ambiguous.
 *
 * Does NOT modify the file system — caller must handle write operations.
 * Content is modified in-memory and returned for further processing.
 */
export function applyEditToContent(
  content: string,
  old_string: string,
  new_string: string,
  replaceAll: boolean = false,
): EditResult {
  // Check if old_string exists in file
  if (!content.includes(old_string)) {
    // Find the most similar region in the file — show the model what's actually there
    // so it can correct its next attempt instead of guessing again.
    const lines = content.split("\n");
    const searchLines = old_string.split("\n");
    const firstSearchLine = searchLines[0].trim();

    let bestMatchLine = -1;

    if (firstSearchLine.length > 5) {
      // Find lines that partially match the first line of old_string
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(firstSearchLine) || firstSearchLine.includes(lines[i].trim())) {
          bestMatchLine = i;
          break;
        }
      }

      // If no partial match, try a looser search — longest common substring
      if (bestMatchLine === -1) {
        const searchWords = firstSearchLine.split(/\s+/).filter(w => w.length > 3);
        let bestScore = 0;
        for (let i = 0; i < lines.length; i++) {
          const lineWords = lines[i].split(/\s+/);
          const score = searchWords.filter(w => lineWords.some(lw => lw.includes(w))).length;
          if (score > bestScore) {
            bestScore = score;
            bestMatchLine = i;
          }
        }
      }
    }

    // Show context around the best match, or the top of file if no match found
    const contextStart = bestMatchLine >= 0 ? Math.max(0, bestMatchLine - 3) : 0;
    const contextEnd = bestMatchLine >= 0 ? Math.min(lines.length, bestMatchLine + searchLines.length + 3) : Math.min(lines.length, 30);
    const contextLines = lines.slice(contextStart, contextEnd).map((l, i) => `${contextStart + i + 1}: ${l}`).join("\n");

    const matchHint = bestMatchLine >= 0
      ? `Closest match found near line ${bestMatchLine + 1}. Here is the actual content around that area:`
      : `No similar text found. Here are the first ${contextEnd} lines of the file:`;

    return {
      status: "not_found",
      hint: `${matchHint}\n\n${contextLines}\n\nRead the file content above carefully and use the EXACT text for old_string.`,
    };
  }

  // Count occurrences
  const occurrences = content.split(old_string).length - 1;

  // If not replaceAll and multiple occurrences, error
  if (!replaceAll && occurrences > 1) {
    return {
      status: "ambiguous",
      occurrences,
      hint: `old_string found ${occurrences} times in file. Either provide more context to make it unique, or set replaceAll: true.`,
    };
  }

  // Perform replacement
  let newContent: string;
  if (replaceAll) {
    newContent = content.split(old_string).join(new_string);
  } else {
    newContent = content.replace(old_string, new_string);
  }

  // Check if content actually changed
  if (content === newContent) {
    return {
      status: "not_found",
      hint: "No changes made. old_string and new_string may be identical.",
    };
  }

  return {
    status: "applied",
    newContent,
    occurrences: replaceAll ? occurrences : 1,
  };
}

export async function execute({
  path: filePath,
  old_string,
  new_string,
  replaceAll = false,
}: EditFileParams): Promise<EditFileResult> {
  try {
    // Resolve to absolute path
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    const content = fs.readFileSync(absolutePath, "utf8");

    // Use shared edit logic
    const result = applyEditToContent(content, old_string, new_string, replaceAll);

    if (result.status !== "applied") {
      return {
        success: false,
        error: result.status === "not_found"
          ? `old_string not found in file. Make sure it matches exactly including whitespace and indentation.`
          : `old_string found ${result.occurrences} times in file. Either provide more context to make it unique, or set replaceAll: true.`,
        hint: result.hint,
        occurrences: result.occurrences,
      };
    }

    // Write back
    fs.writeFileSync(absolutePath, result.newContent!, "utf8");

    // Calculate what changed
    const oldLines = content.split("\n").length;
    const newLines = result.newContent!.split("\n").length;
    const linesDiff = newLines - oldLines;

    return {
      success: true,
      path: absolutePath,
      replacements: result.occurrences || 1,
      linesBefore: oldLines,
      linesAfter: newLines,
      linesDiff: linesDiff > 0 ? `+${linesDiff}` : linesDiff.toString(),
    };
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return {
        success: false,
        error: `File not found: ${path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)}`,
      };
    }
    if (err instanceof Error && "code" in err && err.code === "EISDIR") {
      return {
        success: false,
        error: `Path is a directory, not a file: ${path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)}`,
      };
    }
    return {
      success: false,
      error: `Failed to edit file: ${(err as Error).message}`,
    };
  }
}
