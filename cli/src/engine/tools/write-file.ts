import fs from "fs";
import path from "path";

export const name = "write_file";

export const description =
  "Write content to a file. Creates the file if it does not exist, and creates any necessary parent directories. Overwrites existing content.";

export const parameters = {
  type: "object" as const,
  properties: {
    path: {
      type: "string" as const,
      description: "Path to the file to write (absolute or relative to cwd)",
    },
    content: {
      type: "string" as const,
      description: "Content to write to the file",
    },
    encoding: {
      type: "string" as const,
      description: "File encoding (default: utf8)",
    },
    append: {
      type: "boolean" as const,
      description: "Append to file instead of overwriting (default: false)",
    },
  },
  required: ["path", "content"] as const,
};

interface WriteFileParams {
  path: string;
  content: string;
  encoding?: BufferEncoding;
  append?: boolean;
}

interface WriteFileResult {
  success: boolean;
  path?: string;
  size?: number;
  action?: string;
  linesWritten?: number;
  error?: string;
}

export async function execute({
  path: filePath,
  content,
  encoding = "utf8",
  append = false,
}: WriteFileParams): Promise<WriteFileResult> {
  try {
    // Resolve to absolute path
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    // Get directory path
    const dirPath = path.dirname(absolutePath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // Check if path exists and is a directory
    if (fs.existsSync(absolutePath)) {
      const stats = fs.statSync(absolutePath);
      if (stats.isDirectory()) {
        return {
          success: false,
          error: `Path is a directory, cannot write as file: ${absolutePath}`,
        };
      }
    }

    // Write or append to file
    if (append) {
      fs.appendFileSync(absolutePath, content, encoding);
    } else {
      fs.writeFileSync(absolutePath, content, encoding);
    }

    // Get final file stats
    const stats = fs.statSync(absolutePath);

    return {
      success: true,
      path: absolutePath,
      size: stats.size,
      action: append ? "appended" : "written",
      linesWritten: content.split("\n").length,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to write file: ${(err as Error).message}`,
    };
  }
}
