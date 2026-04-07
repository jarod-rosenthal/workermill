import fs from "fs";
import path from "path";

export const name = "view_image";

export const description =
  "Read an image from disk and return it as image content for visual analysis.";

export const parameters = {
  type: "object" as const,
  properties: {
    path: {
      type: "string" as const,
      description: "Path to the image file (absolute or relative to cwd)",
    },
  },
  required: ["path"] as const,
};

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

interface ViewImageParams {
  path: string;
}

interface ViewImageResult {
  success: boolean;
  content?: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: string; mimeType: string }
  >;
  error?: string;
}

export async function execute({ path: filePath }: ViewImageParams): Promise<ViewImageResult> {
  try {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: `Image not found: ${absolutePath}` };
    }

    const stats = fs.statSync(absolutePath);
    if (!stats.isFile()) {
      return { success: false, error: `Path is not a file: ${absolutePath}` };
    }

    if (stats.size > MAX_IMAGE_SIZE_BYTES) {
      return {
        success: false,
        error: `Image is too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Max size: 10MB.`,
      };
    }

    const ext = path.extname(absolutePath).toLowerCase();
    const mimeType = MIME_TYPES[ext];
    if (!mimeType) {
      return {
        success: false,
        error: `Unsupported image extension: ${ext || "(none)"}. Supported: ${Object.keys(MIME_TYPES).join(", ")}`,
      };
    }

    const data = fs.readFileSync(absolutePath);
    return {
      success: true,
      content: [
        { type: "text", text: `Loaded image: ${absolutePath} (${Math.round(stats.size / 1024)}KB)` },
        { type: "image", image: data.toString("base64"), mimeType },
      ],
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to read image: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
