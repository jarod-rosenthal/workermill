import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { pipeline } from "stream/promises";
import { Readable, Transform } from "stream";
import { withHttpResponse } from "../http-request.js";

export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

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

export interface DownloadFileResult {
  success: boolean;
  destination?: string;
  size_bytes?: number;
  content_type?: string;
  sha256?: string;
  status_code?: number;
  error?: string;
}

class HashTransform extends Transform {
  private hash = createHash("sha256");
  private totalBytes = 0;

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
    this.totalBytes += chunk.length;
    if (this.totalBytes > MAX_DOWNLOAD_BYTES) {
      callback(new Error(`Download exceeds ${MAX_DOWNLOAD_BYTES} bytes`));
      return;
    }
    this.hash.update(chunk);
    callback(null, chunk);
  }

  getDigest() {
    return this.hash.digest("hex");
  }

  getTotalBytes() {
    return this.totalBytes;
  }
}

export async function execute({
  url,
  destination,
  overwrite = false,
}: DownloadFileParams, signal?: AbortSignal): Promise<DownloadFileResult> {
  try {
    signal?.throwIfAborted();
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

    // Destination path is already absolute and bounds-checked
    const absolutePath = destination;

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

    return await withHttpResponse(url, { headers: { "User-Agent": "WorkerMill/1.0" } },
      { signal, timeoutMs: 120_000 }, async (response, requestSignal) => {
        if (!response.ok) return { success: false, status_code: response.status, error: `HTTP ${response.status}: ${response.statusText}` };
        if (!response.body) return { success: false, error: "No response body" };
        const declaredSize = Number(response.headers.get("content-length"));
        if (declaredSize > MAX_DOWNLOAD_BYTES) throw new Error(`Download exceeds ${MAX_DOWNLOAD_BYTES} bytes`);
        requestSignal.throwIfAborted();
        // Keep existing content intact until the entire download is verified.
        const temporary = path.join(dirPath, `.workermill-download-${randomUUID()}.tmp`);
        const hashTransform = new HashTransform();
        const writeStream = fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 });
        try {
          // Node's web-stream type differs from the DOM fetch body type.
          const source = Readable.fromWeb(response.body as import("stream/web").ReadableStream<Uint8Array>);
          await pipeline(source, hashTransform, writeStream, { signal: requestSignal });
          requestSignal.throwIfAborted();
          if (overwrite) fs.renameSync(temporary, absolutePath);
          else fs.linkSync(temporary, absolutePath); // Atomic no-clobber if another writer won.
          return {
            success: true, destination: absolutePath, size_bytes: hashTransform.getTotalBytes(),
            content_type: response.headers.get("content-type") || "", sha256: hashTransform.getDigest(), status_code: response.status,
          };
        } finally {
          // pipeline has settled before removing only this operation's temp file.
          try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        }
      });
  } catch (err) {
    return {
      success: false,
      error: `Download failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
