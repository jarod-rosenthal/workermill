import { useRef, useEffect, useCallback } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { FileCode, Pencil, PenTool } from "lucide-react";

export interface CodeFile {
  filePath: string;
  content?: string; // Latest full content (from Write)
  patches: Array<{
    oldStr: string;
    newStr: string;
    expert?: string;
    timestamp: string;
  }>;
  lastTouched: number;
  lastToolName: "Write" | "Edit";
  expert?: string;
}

interface LiveCodeViewerProps {
  files: Record<string, CodeFile>;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
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
  // Handle special filenames like Dockerfile, Makefile
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

const PERSONA_EMOJIS: Record<string, string> = {
  frontend_developer: "\u{1F3A8}",
  backend_developer: "\u2699\uFE0F",
  devops_engineer: "\u{1F527}",
  security_engineer: "\u{1F512}",
  qa_engineer: "\u{1F9EA}",
  tech_writer: "\u{1F4DD}",
  project_manager: "\u{1F4CB}",
  api_developer: "\u{1F50C}",
  database_administrator: "\u{1F5C4}\uFE0F",
  ml_engineer: "\u{1F9E0}",
  data_engineer: "\u{1F4CA}",
  mobile_developer_ios: "\u{1F4F1}",
  mobile_developer_android: "\u{1F916}",
  tech_lead: "\u{1F468}\u200D\u{1F4BC}",
};

export function LiveCodeViewer({
  files,
  selectedFile,
  onSelectFile,
}: LiveCodeViewerProps) {
  const codeContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Sort files by lastTouched (most recent first)
  const sortedFiles = Object.values(files).sort(
    (a, b) => b.lastTouched - a.lastTouched,
  );

  const fileCount = sortedFiles.length;
  const currentFile = selectedFile ? files[selectedFile] : null;

  // Track scroll position for auto-scroll
  const handleScroll = useCallback(() => {
    const el = codeContainerRef.current;
    if (!el) return;
    const threshold = 50;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // Auto-scroll when content changes
  useEffect(() => {
    if (isAtBottomRef.current && codeContainerRef.current) {
      codeContainerRef.current.scrollTop =
        codeContainerRef.current.scrollHeight;
    }
  }, [currentFile?.content, currentFile?.patches.length]);

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
            ? PERSONA_EMOJIS[file.expert] || ""
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
                  {PERSONA_EMOJIS[currentFile.expert] || ""}{" "}
                  {currentFile.expert}
                </span>
              )}
            </div>

            {/* Code content */}
            <div
              ref={codeContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto"
            >
              {currentFile.content ? (
                <SyntaxHighlighter
                  language={getLanguage(currentFile.filePath)}
                  style={oneDark}
                  showLineNumbers
                  customStyle={{
                    margin: 0,
                    borderRadius: 0,
                    fontSize: "0.75rem",
                    lineHeight: "1.4",
                    background: "transparent",
                  }}
                  lineNumberStyle={{
                    minWidth: "2.5em",
                    paddingRight: "1em",
                    color: "rgba(255,255,255,0.2)",
                    userSelect: "none",
                  }}
                >
                  {currentFile.content}
                </SyntaxHighlighter>
              ) : currentFile.patches.length > 0 ? (
                <div className="p-3 space-y-3">
                  {currentFile.patches.map((patch, idx) => (
                    <div key={idx} className="font-mono text-xs">
                      {patch.expert && (
                        <div className="text-muted-foreground text-[10px] mb-1">
                          {PERSONA_EMOJIS[patch.expert] || ""}{" "}
                          {patch.expert} &middot;{" "}
                          {new Date(patch.timestamp).toLocaleTimeString()}
                        </div>
                      )}
                      {patch.oldStr && (
                        <div className="bg-red-500/10 border-l-2 border-red-500 px-2 py-1 whitespace-pre-wrap break-all">
                          <span className="text-red-400 select-none">- </span>
                          <span className="text-red-300">{patch.oldStr}</span>
                        </div>
                      )}
                      {patch.newStr && (
                        <div className="bg-green-500/10 border-l-2 border-green-500 px-2 py-1 whitespace-pre-wrap break-all">
                          <span className="text-green-400 select-none">
                            +{" "}
                          </span>
                          <span className="text-green-300">{patch.newStr}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
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
