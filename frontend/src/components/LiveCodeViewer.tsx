import { useState, useRef, useEffect, useCallback } from "react";
import { FileCode, Pencil, PenTool, Columns2, AlignJustify } from "lucide-react";
import { DiffView } from "./DiffView";

export interface DiffFile {
  filePath: string;
  before: string; // Frozen on first event
  after: string; // Updated on each event
  lastTouched: number;
  lastToolName: "Write" | "Edit";
  expert?: string;
}

interface LiveCodeViewerProps {
  files: Record<string, DiffFile>;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
  personaEmojis?: Record<string, string>;
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  css: "css",
  scss: "scss",
  html: "html",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  dockerfile: "dockerfile",
  toml: "toml",
  xml: "xml",
  graphql: "graphql",
  prisma: "prisma",
  env: "bash",
};

function getLanguage(filePath: string): string {
  const basename = filePath.split("/").pop() || "";
  const lower = basename.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";

  const ext = basename.split(".").pop()?.toLowerCase() || "";
  return EXT_TO_LANGUAGE[ext] || "text";
}

function getBasename(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

function getDirPath(filePath: string): string {
  const parts = filePath.split("/");
  parts.pop();
  return parts.join("/") || ".";
}

export function LiveCodeViewer({
  files,
  selectedFile,
  onSelectFile,
  personaEmojis,
}: LiveCodeViewerProps) {
  const codeContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");

  const sortedFiles = Object.values(files).sort(
    (a, b) => b.lastTouched - a.lastTouched,
  );

  const fileCount = sortedFiles.length;
  const currentFile = selectedFile ? files[selectedFile] : null;

  const handleScroll = useCallback(() => {
    const el = codeContainerRef.current;
    if (!el) return;
    const threshold = 50;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current && codeContainerRef.current) {
      codeContainerRef.current.scrollTop =
        codeContainerRef.current.scrollHeight;
    }
  }, [currentFile?.after]);

  if (fileCount === 0) {
    return (
      <div className="flex items-center justify-center h-96 text-muted-foreground text-sm">
        <div className="text-center">
          <FileCode className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>Code changes will appear here as workers write files.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-96">
      {/* File sidebar */}
      <div className="w-48 border-r border-border overflow-y-auto bg-muted/20 flex-shrink-0">
        {sortedFiles.map((file) => {
          const basename = getBasename(file.filePath);
          const dirPath = getDirPath(file.filePath);
          const isSelected = file.filePath === selectedFile;
          const expertEmoji = file.expert
            ? personaEmojis?.[file.expert] || ""
            : "";

          return (
            <button
              key={file.filePath}
              onClick={() => onSelectFile(file.filePath)}
              className={`w-full text-left px-2 py-1.5 text-xs border-b border-border/30 hover:bg-muted/50 transition-colors ${
                isSelected
                  ? "bg-primary/10 border-l-2 border-l-primary"
                  : ""
              }`}
              title={file.filePath}
            >
              <div className="flex items-center gap-1.5">
                {file.lastToolName === "Write" ? (
                  <PenTool className="w-3 h-3 text-green-400 flex-shrink-0" />
                ) : (
                  <Pencil className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                )}
                <span className="truncate font-mono">{basename}</span>
                {expertEmoji && (
                  <span className="flex-shrink-0 text-[10px]">
                    {expertEmoji}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground truncate mt-0.5 pl-[18px]">
                {dirPath}
              </div>
            </button>
          );
        })}
      </div>

      {/* Code viewer */}
      <div className="flex-1 min-w-0 flex flex-col">
        {currentFile ? (
          <>
            {/* File path header */}
            <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-muted/30 text-xs">
              <span className="font-mono text-muted-foreground truncate">
                {currentFile.filePath}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  currentFile.lastToolName === "Write"
                    ? "bg-green-500/20 text-green-400"
                    : "bg-yellow-500/20 text-yellow-400"
                }`}
              >
                {currentFile.lastToolName}
              </span>
              {currentFile.expert && (
                <span className="text-[10px] text-muted-foreground">
                  {personaEmojis?.[currentFile.expert] || ""}{" "}
                  {currentFile.expert}
                </span>
              )}
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  onClick={() => setViewMode("unified")}
                  className={`p-1 rounded ${viewMode === "unified" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  title="Unified view"
                >
                  <AlignJustify className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setViewMode("split")}
                  className={`p-1 rounded ${viewMode === "split" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  title="Split view"
                >
                  <Columns2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Diff content */}
            <div
              ref={codeContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto"
            >
              {currentFile.before !== "" || currentFile.after !== "" ? (
                <DiffView
                  before={currentFile.before}
                  after={currentFile.after}
                  language={getLanguage(currentFile.filePath)}
                  viewMode={viewMode}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  No content available
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <div className="text-center">
              <FileCode className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <p>Select a file to view its content</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
