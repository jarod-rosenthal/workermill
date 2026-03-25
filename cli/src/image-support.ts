import fs from "fs";
import path from "path";

interface ContentPart {
  type: "text" | "image";
  text?: string;
  image?: string; // base64
  mimeType?: string;
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

/**
 * Parse user input for image file references.
 * Supports @path/to/image.png syntax.
 * Returns structured content parts for the AI SDK.
 */
export function parseImageReferences(
  input: string,
  workingDir: string,
): { parts: ContentPart[]; hasImages: boolean } {
  const parts: ContentPart[] = [];
  let hasImages = false;

  // Match @path/to/file.ext patterns
  const atPattern = /@([\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp))\b/gi;
  const matches = [...input.matchAll(atPattern)];

  if (matches.length === 0) {
    return { parts: [{ type: "text", text: input }], hasImages: false };
  }

  let lastIndex = 0;
  for (const match of matches) {
    const filePath = match[1];
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(workingDir, filePath);

    // Path traversal guard — stay within working directory
    const normalizedWork = path.resolve(workingDir);
    if (!path.resolve(fullPath).startsWith(normalizedWork)) {
      parts.push({ type: "text", text: `(blocked: ${filePath} is outside working directory)` });
      lastIndex = (match.index || 0) + match[0].length;
      continue;
    }

    // Add text before this match
    const textBefore = input.slice(lastIndex, match.index).trim();
    if (textBefore) {
      parts.push({ type: "text", text: textBefore });
    }

    try {
      if (fs.existsSync(fullPath)) {
        const data = fs.readFileSync(fullPath);
        const ext = path.extname(fullPath).toLowerCase();
        const mimeType = MIME_TYPES[ext] || "image/png";
        parts.push({ type: "image", image: data.toString("base64"), mimeType });
        hasImages = true;
      } else {
        parts.push({ type: "text", text: `(image not found: ${filePath})` });
      }
    } catch {
      parts.push({ type: "text", text: `(failed to read: ${filePath})` });
    }

    lastIndex = (match.index || 0) + match[0].length;
  }

  const textAfter = input.slice(lastIndex).trim();
  if (textAfter) {
    parts.push({ type: "text", text: textAfter });
  }

  return { parts, hasImages };
}

/**
 * Convert parsed content parts to AI SDK message format.
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

/**
 * Parse @file references for text files (not images).
 * Returns the input with @file references replaced by file contents.
 */
export function resolveFileReferences(input: string, workingDir: string): string {
  const filePattern = /@([\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|json|yaml|yml|toml|md|txt|css|html|sql|sh|env|cfg|conf|xml))\b/gi;
  const matches = [...input.matchAll(filePattern)];

  if (matches.length === 0) return input;

  let result = input;
  for (const match of matches) {
    const filePath = match[1];
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(workingDir, filePath);

    // Path traversal guard
    const normalizedWork = path.resolve(workingDir);
    if (!path.resolve(fullPath).startsWith(normalizedWork)) {
      result = result.replace(match[0], `(blocked: ${filePath} is outside working directory)`);
      continue;
    }

    try {
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const truncated = content.length > 10000
          ? content.slice(0, 10000) + "\n... (truncated at 10KB)"
          : content;
        result = result.replace(match[0], `\n\`\`\`${path.extname(filePath).slice(1)}\n// ${filePath}\n${truncated}\n\`\`\`\n`);
      } else {
        result = result.replace(match[0], `(file not found: ${filePath})`);
      }
    } catch {
      result = result.replace(match[0], `(failed to read: ${filePath})`);
    }
  }

  return result;
}
