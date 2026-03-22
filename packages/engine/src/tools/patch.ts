import fs from "fs";
import path from "path";

export const name = "patch";

export const description =
  "Apply a unified diff patch to one or more files atomically. " +
  "All hunks are validated before any changes are written. " +
  "If any hunk fails to apply, no files are modified. " +
  "Use standard unified diff format (output of `git diff` or `diff -u`).";

export const parameters = {
  type: "object" as const,
  properties: {
    patch_text: {
      type: "string" as const,
      description:
        "The unified diff patch text. Must use standard format with --- and +++ headers and @@ hunk markers.",
    },
  },
  required: ["patch_text"] as const,
};

interface PatchParams {
  patch_text: string;
}

interface HunkLine {
  type: "context" | "add" | "remove";
  content: string;
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: HunkLine[];
}

interface FilePatch {
  oldFile: string;
  newFile: string;
  hunks: Hunk[];
  isNew: boolean;
  isDelete: boolean;
}

interface PatchResult {
  success: boolean;
  filesModified: string[];
  filesCreated: string[];
  filesDeleted: string[];
  error?: string;
  hint?: string;
}

function parsePatch(patchText: string): FilePatch[] {
  const patches: FilePatch[] = [];
  const lines = patchText.split("\n");
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].startsWith("--- ")) {
      i++;
      continue;
    }

    const oldFile = lines[i].replace(/^--- (a\/)?/, "").replace(/\t.*$/, "");
    i++;

    if (i >= lines.length || !lines[i].startsWith("+++ ")) {
      continue;
    }

    const newFile = lines[i].replace(/^\+\+\+ (b\/)?/, "").replace(/\t.*$/, "");
    i++;

    const isNew = oldFile === "/dev/null";
    const isDelete = newFile === "/dev/null";

    const filePatch: FilePatch = {
      oldFile: isNew ? newFile : oldFile,
      newFile: isDelete ? oldFile : newFile,
      hunks: [],
      isNew,
      isDelete,
    };

    while (i < lines.length && lines[i].startsWith("@@")) {
      const match = lines[i].match(
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
      );
      if (!match) {
        i++;
        continue;
      }

      const hunk: Hunk = {
        oldStart: parseInt(match[1], 10),
        oldCount: match[2] !== undefined ? parseInt(match[2], 10) : 1,
        newStart: parseInt(match[3], 10),
        newCount: match[4] !== undefined ? parseInt(match[4], 10) : 1,
        lines: [],
      };

      i++;

      while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith("@@") || line.startsWith("--- ") || line.startsWith("diff ")) {
          break;
        }

        if (line.startsWith("+")) {
          hunk.lines.push({ type: "add", content: line.slice(1) });
        } else if (line.startsWith("-")) {
          hunk.lines.push({ type: "remove", content: line.slice(1) });
        } else if (line.startsWith(" ") || line === "") {
          hunk.lines.push({
            type: "context",
            content: line.startsWith(" ") ? line.slice(1) : line,
          });
        }
        i++;
      }

      filePatch.hunks.push(hunk);
    }

    if (filePatch.hunks.length > 0) {
      patches.push(filePatch);
    }
  }

  return patches;
}

function applyHunks(originalContent: string, hunks: Hunk[]): string | null {
  const originalLines = originalContent.split("\n");
  if (originalLines[originalLines.length - 1] === "" && originalContent.endsWith("\n")) {
    originalLines.pop();
  }

  let offset = 0;
  const resultLines = [...originalLines];

  for (const hunk of hunks) {
    const startLine = hunk.oldStart - 1 + offset;

    let lineIdx = startLine;
    for (const hunkLine of hunk.lines) {
      if (hunkLine.type === "context" || hunkLine.type === "remove") {
        if (lineIdx >= resultLines.length || resultLines[lineIdx] !== hunkLine.content) {
          return null;
        }
        lineIdx++;
      }
    }

    const newLines: string[] = [];
    for (const hunkLine of hunk.lines) {
      if (hunkLine.type === "context") {
        newLines.push(hunkLine.content);
      } else if (hunkLine.type === "add") {
        newLines.push(hunkLine.content);
      }
    }

    resultLines.splice(startLine, hunk.oldCount, ...newLines);
    offset += newLines.length - hunk.oldCount;
  }

  return resultLines.join("\n") + "\n";
}

export async function execute({ patch_text }: PatchParams): Promise<PatchResult> {
  try {
    const patches = parsePatch(patch_text);

    if (patches.length === 0) {
      return {
        success: false, filesModified: [], filesCreated: [], filesDeleted: [],
        error: "No valid patches found in input",
        hint: "Ensure the patch uses unified diff format with --- and +++ headers and @@ hunk markers.",
      };
    }

    const pendingWrites: Map<string, string> = new Map();
    const pendingDeletes: string[] = [];
    const errors: string[] = [];

    for (const filePatch of patches) {
      const targetFile = filePatch.newFile;

      if (filePatch.isNew) {
        const content = filePatch.hunks
          .flatMap((h) => h.lines.filter((l) => l.type === "add").map((l) => l.content))
          .join("\n") + "\n";
        pendingWrites.set(targetFile, content);
        continue;
      }

      if (filePatch.isDelete) {
        if (!fs.existsSync(filePatch.oldFile)) {
          errors.push(`Cannot delete ${filePatch.oldFile}: file not found`);
          continue;
        }
        pendingDeletes.push(filePatch.oldFile);
        continue;
      }

      if (!fs.existsSync(targetFile)) {
        errors.push(`Cannot patch ${targetFile}: file not found`);
        continue;
      }

      const originalContent = fs.readFileSync(targetFile, "utf-8");
      const result = applyHunks(originalContent, filePatch.hunks);

      if (result === null) {
        errors.push(`Patch for ${targetFile} failed: context lines do not match. The file may have been modified since the diff was generated.`);
        continue;
      }

      pendingWrites.set(targetFile, result);
    }

    if (errors.length > 0) {
      return {
        success: false, filesModified: [], filesCreated: [], filesDeleted: [],
        error: `Patch validation failed:\n${errors.join("\n")}`,
        hint: "All hunks must match the current file contents exactly. Regenerate the diff against the current file state.",
      };
    }

    const filesModified: string[] = [];
    const filesCreated: string[] = [];
    const filesDeleted: string[] = [];

    for (const [filePath, content] of pendingWrites) {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const isNew = !fs.existsSync(filePath);
      fs.writeFileSync(filePath, content, "utf-8");

      if (isNew) {
        filesCreated.push(filePath);
      } else {
        filesModified.push(filePath);
      }
    }

    for (const filePath of pendingDeletes) {
      fs.unlinkSync(filePath);
      filesDeleted.push(filePath);
    }

    return { success: true, filesModified, filesCreated, filesDeleted };
  } catch (err) {
    return {
      success: false, filesModified: [], filesCreated: [], filesDeleted: [],
      error: `Patch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
