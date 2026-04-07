import fs from "fs";
import path from "path";
import { createHash } from "crypto";

export const name = "download_file";

export const description =
  "Download a file from a URL and save it to the local filesystem. Supports streaming for large files, SHA-256 checksum calculation, and path safety checks.";

export const parameters = {
  type: "object" as const,
  properties: {
    url: {
      type: "string" as const,
      description: "The URL to download from",
    },
    destination: {
      type: "string" as const,
      description: "Path to save the file (absolute or relative to cwd)",
    },
    overwrite: {
      type: "boolean" as const,
      description: "Whether to overwrite existing files (default: false)",
      default: false,
    },
  },
  required: ["url", "destination"] as const,
};

interface DownloadFileParams {
  url: string;
  destination: string;
  overwrite?: boolean;
}

interface DownloadFileResult {
  success: boolean;
  destination?: string;
  size_bytes?: number;
  content_type?: string;
  sha256?: string;
  status_code?: number;
  error?: string;
}

export async function execute({
  url,
  destination,
  overwrite = false,
}: DownloadFileParams): Promise<DownloadFileResult> {
  try {
    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { success: false, error: `Invalid URL: ${url}` };
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return { success: false, error: `Unsupported protocol: ${parsedUrl.protocol}. Only http and https are allowed.` };
    }

    // Resolve destination path
    const absolutePath = path.isAbsolute(destination)
      ? destination
      : path.resolve(process.cwd(), destination);

    // Create directory if it doesn't exist
    const dirPath = path.dirname(absolutePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // Check if file already exists and overwrite is not allowed
    if (!overwrite && fs.existsSync(absolutePath)) {
      return { success: false, error: `File already exists: ${absolutePath}. Set overwrite=true to replace it.` };
    }

    // Check if path is a directory
    if (fs.existsSync(absolutePath)) {
      const stats = fs.statSync(absolutePath);
      if (stats.isDirectory()) {
        return { success: false, error: `Path is a directory, cannot write as file: ${absolutePath}` };
      }
    }

    // Fetch the URL
    const response = await globalThis.fetch(url, {
      headers: {
        "User-Agent": "WorkerMill/1.0",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        status_code: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    // Get content type
    const contentType = response.headers.get("content-type") || "";

    // Create write stream and hash
    const writeStream = fs.createWriteStream(absolutePath);
    const hash = createHash("sha256");

    let totalBytes = 0;

    // Stream the response body through hash and to file
    const reader = response.body?.getReader();
    if (!reader) {
      return { success: false, error: "No response body" };
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Update hash and write to file
        hash.update(value);
        writeStream.write(value);
        totalBytes += value.length;
      }

      // Close the write stream
      writeStream.end();

      // Wait for write stream to finish
      await new Promise<void>((resolve, reject) => {
        writeStream.on("finish", () => resolve());
        writeStream.on("error", reject);
      });

      const sha256 = hash.digest("hex");

      return {
        success: true,
        destination: absolutePath,
        size_bytes: totalBytes,
        content_type: contentType,
        sha256,
        status_code: response.status,
      };
    } catch (streamError) {
      // Clean up partial file on error
      writeStream.destroy();
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
      throw streamError;
    }
  } catch (err) {
    return {
      success: false,
      error: `Download failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}