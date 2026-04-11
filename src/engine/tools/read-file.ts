import fs from "fs";
import path from "path";

export const name = "read_file";

export const description =
  "Read the contents of a file. Returns the file content as a string. Supports text files of any type.";

export const parameters = {
  type: "object" as const,
  properties: {
    path: {
      type: "string" as const,
      description: "Path to the file to read (absolute or relative to cwd)",
    },
    encoding: {
      type: "string" as const,
      description: "File encoding (default: utf8)",
    },
    maxLines: {
      type: "number" as const,
      description:
        "Maximum number of lines to read (optional, reads entire file if not specified)",
    },
    startLine: {
      type: "number" as const,
      description: "Line number to start reading from (1-indexed, optional)",
    },
  },
  required: ["path"] as const,
};

interface ReadFileParams {
  path: string;
  encoding?: BufferEncoding;
  maxLines?: number;
  startLine?: number;
}

interface ReadFileResult {
  success: boolean;
  content?: string;
  path?: string;
  totalLines?: number;
  linesReturned?: number;
  startLine?: number;
  endLine?: number;
  size?: number;
  error?: string;
}

export async function execute({
  path: filePath,
  encoding = "utf8",
  maxLines,
  startLine,
}: ReadFileParams): Promise<ReadFileResult> {
  try {
    // Resolve to absolute path
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    const fd = fs.openSync(absolutePath, "r");
    let content: string;
    let size: number;
    try {
      const stats = fs.fstatSync(fd);
      if (stats.isDirectory()) {
        return {
          success: false,
          error: `Path is a directory, not a file: ${absolutePath}`,
        };
      }

      // Check file size (warn if large)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (stats.size > maxSize) {
        return {
          success: false,
          error: `File is too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Max size: 10MB. Use maxLines parameter to read partial content.`,
        };
      }

      size = stats.size;
      content = fs.readFileSync(fd, { encoding });
    } finally {
      fs.closeSync(fd);
    }

    // Handle line-based reading if specified
    if (startLine !== undefined || maxLines !== undefined) {
      const lines = content.split("\n");
      const start = (startLine || 1) - 1; // Convert to 0-indexed
      const end =
        maxLines !== undefined ? start + maxLines : lines.length;

      content = lines.slice(start, end).join("\n");

      return {
        success: true,
        content,
        path: absolutePath,
        totalLines: lines.length,
        linesReturned: Math.min(end - start, lines.length - start),
        startLine: start + 1,
        endLine: Math.min(end, lines.length),
      };
    }

    return {
      success: true,
      content,
      path: absolutePath,
      size,
    };
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return {
        success: false,
        error: `File not found: ${path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)}`,
      };
    }
    return {
      success: false,
      error: `Failed to read file: ${(err as Error).message}`,
    };
  }
}
