import fs from "fs";
import path from "path";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];

interface ContentPart {
  type: "text" | "image";
  text?: string;
  image?: string; // base64 data URL
  mimeType?: string;
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

/**
 * Parse user input for image file references.
 * Supports @path/to/image.png syntax and bare file paths ending in image extensions.
 * Returns structured content parts for the AI SDK.
 */
export function parseImageReferences(
  input: string,
  workingDir: string,
): { parts: ContentPart[]; hasImages: boolean } {
  const parts: ContentPart[] = [];
  let hasImages = false;
  let remainingText = input;

  // Match @path/to/file.ext patterns
  const atPattern = /@([\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg))\b/gi;
  const matches = [...input.matchAll(atPattern)];

  if (matches.length === 0) {
    return { parts: [{ type: "text", text: input }], hasImages: false };
  }

  // Process each image reference
  let lastIndex = 0;
  for (const match of matches) {
    const filePath = match[1];
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(workingDir, filePath);

    // Add text before this match
    const textBefore = input.slice(lastIndex, match.index).trim();
    if (textBefore) {
      parts.push({ type: "text", text: textBefore });
    }

    // Try to read the image
    try {
      if (fs.existsSync(fullPath)) {
        const data = fs.readFileSync(fullPath);
        const ext = path.extname(fullPath).toLowerCase();
        const mimeType = MIME_TYPES[ext] || "image/png";
        parts.push({
          type: "image",
          image: data.toString("base64"),
          mimeType,
        });
        hasImages = true;
        // Remove the @reference from the remaining text
        remainingText = remainingText.replace(match[0], "").trim();
      } else {
        // File not found — keep as text
        parts.push({ type: "text", text: `(image not found: ${filePath})` });
      }
    } catch {
      parts.push({ type: "text", text: `(failed to read: ${filePath})` });
    }

    lastIndex = (match.index || 0) + match[0].length;
  }

  // Add remaining text after last match
  const textAfter = input.slice(lastIndex).trim();
  if (textAfter) {
    parts.push({ type: "text", text: textAfter });
  }

  return { parts, hasImages };
}

/**
 * Convert parsed content parts to AI SDK message format.
 * Returns either a plain string (no images) or an array of content parts.
 */
export function toMessageContent(
  parts: ContentPart[],
): string | Array<{ type: "text"; text: string } | { type: "image"; image: string; mimeType?: string }> {
  if (parts.length === 1 && parts[0].type === "text") {
    return parts[0].text || "";
  }

  return parts.map((p) => {
    if (p.type === "image") {
      return { type: "image" as const, image: p.image!, mimeType: p.mimeType };
    }
    return { type: "text" as const, text: p.text || "" };
  });
}
