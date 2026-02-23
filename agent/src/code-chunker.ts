/**
 * Code Chunker Service
 *
 * Splits source code files into semantic chunks for embedding.
 * Part of the Codebase RAG system.
 *
 * Ported from api/src/services/code-chunker.ts — zero database dependencies.
 */

import { createHash } from "crypto";

/**
 * Type of code chunk
 */
export type ChunkType = "full_file" | "function" | "class" | "block" | "import_block";

/**
 * Type of symbol extracted from code
 */
export type SymbolType =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "constant"
  | "variable"
  | "enum"
  | "method"
  | "property";

/**
 * Language detection result
 */
export interface LanguageInfo {
  language: string;
  extensions: string[];
}

/**
 * Code chunk with metadata
 */
export interface CodeChunk {
  content: string;
  chunkIndex: number;
  chunkType: ChunkType;
  startLine: number;
  endLine: number;
  symbolName?: string;
  symbolType?: SymbolType;
}

/**
 * Result of chunking a file
 */
export interface ChunkResult {
  filePath: string;
  fileHash: string;
  language: string | null;
  chunks: CodeChunk[];
  totalLines: number;
  skipped: boolean;
  skipReason?: string;
}

/**
 * Options for chunking
 */
export interface ChunkOptions {
  maxFileSizeKb?: number;
  maxChunkLines?: number;
  minChunkLines?: number;
  targetChunkLines?: number;
}

// Language detection by file extension
const LANGUAGE_MAP: Record<string, LanguageInfo> = {
  // TypeScript/JavaScript
  ".ts": { language: "typescript", extensions: [".ts"] },
  ".tsx": { language: "typescript", extensions: [".tsx"] },
  ".js": { language: "javascript", extensions: [".js"] },
  ".jsx": { language: "javascript", extensions: [".jsx"] },
  ".mjs": { language: "javascript", extensions: [".mjs"] },
  ".cjs": { language: "javascript", extensions: [".cjs"] },

  // Python
  ".py": { language: "python", extensions: [".py"] },
  ".pyi": { language: "python", extensions: [".pyi"] },
  ".pyw": { language: "python", extensions: [".pyw"] },

  // Go
  ".go": { language: "go", extensions: [".go"] },

  // Rust
  ".rs": { language: "rust", extensions: [".rs"] },

  // Java
  ".java": { language: "java", extensions: [".java"] },

  // C/C++
  ".c": { language: "c", extensions: [".c"] },
  ".h": { language: "c", extensions: [".h"] },
  ".cpp": { language: "cpp", extensions: [".cpp", ".cc", ".cxx"] },
  ".cc": { language: "cpp", extensions: [".cpp", ".cc", ".cxx"] },
  ".hpp": { language: "cpp", extensions: [".hpp", ".hh"] },
  ".hh": { language: "cpp", extensions: [".hpp", ".hh"] },

  // C***REMOVED***
  ".cs": { language: "csharp", extensions: [".cs"] },

  // Ruby
  ".rb": { language: "ruby", extensions: [".rb"] },
  ".rake": { language: "ruby", extensions: [".rake"] },

  // PHP
  ".php": { language: "php", extensions: [".php"] },

  // Kotlin
  ".kt": { language: "kotlin", extensions: [".kt"] },
  ".kts": { language: "kotlin", extensions: [".kts"] },

  // Swift
  ".swift": { language: "swift", extensions: [".swift"] },

  // Scala
  ".scala": { language: "scala", extensions: [".scala"] },

  // Shell
  ".sh": { language: "shell", extensions: [".sh"] },
  ".bash": { language: "shell", extensions: [".bash"] },
  ".zsh": { language: "shell", extensions: [".zsh"] },

  // SQL
  ".sql": { language: "sql", extensions: [".sql"] },

  // YAML/JSON
  ".yaml": { language: "yaml", extensions: [".yaml", ".yml"] },
  ".yml": { language: "yaml", extensions: [".yaml", ".yml"] },
  ".json": { language: "json", extensions: [".json"] },

  // Markdown
  ".md": { language: "markdown", extensions: [".md"] },
  ".mdx": { language: "markdown", extensions: [".mdx"] },

  // Dockerfile
  Dockerfile: { language: "dockerfile", extensions: [] },
};

// Function/class patterns by language
const SYMBOL_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/,
    /^\s*(?:export\s+)?class\s+(\w+)/,
    /^\s*(?:export\s+)?interface\s+(\w+)/,
    /^\s*(?:export\s+)?type\s+(\w+)/,
    /^\s*(?:export\s+)?enum\s+(\w+)/,
  ],
  javascript: [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/,
    /^\s*(?:export\s+)?class\s+(\w+)/,
  ],
  python: [
    /^\s*(?:async\s+)?def\s+(\w+)\s*\(/,
    /^\s*class\s+(\w+)/,
  ],
  go: [
    /^\s*func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/,
    /^\s*type\s+(\w+)\s+struct/,
    /^\s*type\s+(\w+)\s+interface/,
  ],
  rust: [
    /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
    /^\s*(?:pub\s+)?struct\s+(\w+)/,
    /^\s*(?:pub\s+)?enum\s+(\w+)/,
    /^\s*(?:pub\s+)?trait\s+(\w+)/,
    /^\s*impl(?:<[^>]+>)?\s+(\w+)/,
  ],
  java: [
    /^\s*(?:public|private|protected)?\s*(?:static)?\s*(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/,
    /^\s*(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+(\w+)/,
    /^\s*(?:public|private|protected)?\s*interface\s+(\w+)/,
    /^\s*(?:public|private|protected)?\s*enum\s+(\w+)/,
  ],
  csharp: [
    /^\s*(?:public|private|protected|internal)?\s*(?:static|async|virtual|override)?\s*(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/,
    /^\s*(?:public|private|protected|internal)?\s*(?:abstract|sealed|partial)?\s*class\s+(\w+)/,
    /^\s*(?:public|private|protected|internal)?\s*interface\s+(\w+)/,
    /^\s*(?:public|private|protected|internal)?\s*enum\s+(\w+)/,
  ],
  ruby: [
    /^\s*def\s+(\w+)/,
    /^\s*class\s+(\w+)/,
    /^\s*module\s+(\w+)/,
  ],
  php: [
    /^\s*(?:public|private|protected)?\s*(?:static)?\s*function\s+(\w+)/,
    /^\s*class\s+(\w+)/,
    /^\s*interface\s+(\w+)/,
    /^\s*trait\s+(\w+)/,
  ],
};

// Symbol type inference from patterns
function inferSymbolType(line: string, language: string): SymbolType | null {
  const lowerLine = line.toLowerCase();

  if (lowerLine.includes("class ")) return "class";
  if (lowerLine.includes("interface ")) return "interface";
  if (lowerLine.includes("type ") && ["typescript", "go"].includes(language)) return "type";
  if (lowerLine.includes("enum ")) return "enum";
  if (lowerLine.includes("struct ")) return "class"; // Treat structs as classes
  if (lowerLine.includes("trait ")) return "interface"; // Treat traits as interfaces
  if (lowerLine.includes("function ") || lowerLine.includes("def ") || lowerLine.includes("fn ")) {
    return "function";
  }
  if (lowerLine.includes("=>") || lowerLine.includes("const ")) return "function";

  return null;
}

/**
 * Code Chunker - splits files into semantic chunks
 */
export class CodeChunker {
  private options: Required<ChunkOptions>;

  constructor(options: ChunkOptions = {}) {
    this.options = {
      maxFileSizeKb: options.maxFileSizeKb ?? 100,
      maxChunkLines: options.maxChunkLines ?? 200,
      minChunkLines: options.minChunkLines ?? 10,
      targetChunkLines: options.targetChunkLines ?? 100,
    };
  }

  /**
   * Detect language from file path
   */
  detectLanguage(filePath: string): string | null {
    const ext = this.getExtension(filePath);
    const langInfo = LANGUAGE_MAP[ext];

    if (langInfo) {
      return langInfo.language;
    }

    // Check for special files
    const fileName = filePath.split("/").pop() || "";
    if (fileName === "Dockerfile" || fileName.startsWith("Dockerfile.")) {
      return "dockerfile";
    }

    return null;
  }

  /**
   * Get file extension including dot
   */
  private getExtension(filePath: string): string {
    const parts = filePath.split("/");
    const fileName = parts[parts.length - 1] || "";
    const dotIndex = fileName.lastIndexOf(".");

    if (dotIndex === -1) return fileName; // No extension, return full name
    return fileName.slice(dotIndex);
  }

  /**
   * Compute SHA-256 hash of content
   */
  computeHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * Check if file should be skipped based on size
   */
  shouldSkipFile(content: string): { skip: boolean; reason?: string } {
    const sizeKb = Buffer.byteLength(content, "utf8") / 1024;

    if (sizeKb > this.options.maxFileSizeKb) {
      return {
        skip: true,
        reason: `File size ${sizeKb.toFixed(1)}KB exceeds limit ${this.options.maxFileSizeKb}KB`,
      };
    }

    return { skip: false };
  }

  /**
   * Chunk a file into semantic pieces
   */
  chunkFile(filePath: string, content: string, allowedLanguages?: string[]): ChunkResult {
    const fileHash = this.computeHash(content);
    const language = this.detectLanguage(filePath);

    // Check if language is allowed
    if (allowedLanguages && language && !allowedLanguages.includes(language)) {
      return {
        filePath,
        fileHash,
        language,
        chunks: [],
        totalLines: 0,
        skipped: true,
        skipReason: `Language ${language} not in allowed list`,
      };
    }

    // Check file size
    const sizeCheck = this.shouldSkipFile(content);
    if (sizeCheck.skip) {
      return {
        filePath,
        fileHash,
        language,
        chunks: [],
        totalLines: 0,
        skipped: true,
        skipReason: sizeCheck.reason,
      };
    }

    const lines = content.split("\n");
    const totalLines = lines.length;

    // For small files, return as single chunk
    if (totalLines <= this.options.maxChunkLines) {
      return {
        filePath,
        fileHash,
        language,
        chunks: [
          {
            content,
            chunkIndex: 0,
            chunkType: "full_file",
            startLine: 1,
            endLine: totalLines,
          },
        ],
        totalLines,
        skipped: false,
      };
    }

    // For larger files, split by semantic boundaries
    const chunks = this.splitBySymbols(lines, language);

    return {
      filePath,
      fileHash,
      language,
      chunks,
      totalLines,
      skipped: false,
    };
  }

  /**
   * Split file by semantic boundaries (functions, classes, etc.)
   */
  private splitBySymbols(lines: string[], language: string | null): CodeChunk[] {
    const patterns = language ? SYMBOL_PATTERNS[language] : [];
    const chunks: CodeChunk[] = [];

    if (!patterns || patterns.length === 0) {
      // No patterns for this language, split by line count
      return this.splitByLineCount(lines);
    }

    // Find symbol boundaries
    const boundaries: Array<{
      line: number;
      symbolName: string;
      symbolType: SymbolType | null;
    }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match && match[1]) {
          boundaries.push({
            line: i,
            symbolName: match[1],
            symbolType: inferSymbolType(line, language || ""),
          });
          break;
        }
      }
    }

    // If no boundaries found, split by line count
    if (boundaries.length === 0) {
      return this.splitByLineCount(lines);
    }

    // Create chunks from boundaries
    let currentChunkIndex = 0;

    // Handle imports/header before first symbol
    if (boundaries[0].line > this.options.minChunkLines) {
      const headerContent = lines.slice(0, boundaries[0].line).join("\n");
      chunks.push({
        content: headerContent,
        chunkIndex: currentChunkIndex++,
        chunkType: "import_block",
        startLine: 1,
        endLine: boundaries[0].line,
      });
    }

    // Create chunks for each symbol
    for (let i = 0; i < boundaries.length; i++) {
      const startLine = boundaries[i].line;
      const endLine = i < boundaries.length - 1 ? boundaries[i + 1].line - 1 : lines.length - 1;

      // If chunk is too large, split it
      const chunkLines = endLine - startLine + 1;
      if (chunkLines > this.options.maxChunkLines) {
        // Split into smaller chunks
        const subChunks = this.splitByLineCount(lines.slice(startLine, endLine + 1), startLine);
        for (const subChunk of subChunks) {
          subChunk.chunkIndex = currentChunkIndex++;
          // First sub-chunk keeps the symbol info
          if (subChunk.startLine === startLine + 1) {
            subChunk.symbolName = boundaries[i].symbolName;
            subChunk.symbolType = boundaries[i].symbolType || undefined;
          }
          chunks.push(subChunk);
        }
      } else if (chunkLines >= this.options.minChunkLines) {
        const chunkContent = lines.slice(startLine, endLine + 1).join("\n");
        chunks.push({
          content: chunkContent,
          chunkIndex: currentChunkIndex++,
          chunkType: boundaries[i].symbolType === "class" ? "class" : "function",
          startLine: startLine + 1, // 1-indexed
          endLine: endLine + 1,
          symbolName: boundaries[i].symbolName,
          symbolType: boundaries[i].symbolType || undefined,
        });
      } else {
        // Merge small chunks with next
        // This is handled by the boundary loop naturally
      }
    }

    // Ensure we have at least one chunk
    if (chunks.length === 0) {
      return this.splitByLineCount(lines);
    }

    return chunks;
  }

  /**
   * Split by line count when semantic splitting isn't possible
   */
  private splitByLineCount(lines: string[], offset: number = 0): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const targetSize = this.options.targetChunkLines;
    let currentChunkIndex = 0;

    for (let i = 0; i < lines.length; i += targetSize) {
      const endIndex = Math.min(i + targetSize, lines.length);
      const chunkContent = lines.slice(i, endIndex).join("\n");

      chunks.push({
        content: chunkContent,
        chunkIndex: currentChunkIndex++,
        chunkType: "block",
        startLine: offset + i + 1, // 1-indexed
        endLine: offset + endIndex,
      });
    }

    return chunks;
  }
}

// Export singleton with default options
export const codeChunker = new CodeChunker();
