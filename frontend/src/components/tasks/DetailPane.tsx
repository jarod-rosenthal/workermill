import { useMemo } from "react";
import { FileCode, FilePlus, AlertTriangle, XCircle } from "lucide-react";
import type { ContextMessage } from "../../store/coordination-store";
import type { ParsedError } from "./mock-data";

interface DetailPaneProps {
  coordinationMessages: ContextMessage[];
  errors: ParsedError[];
  selectedStoryIndex: number | null;
  onErrorClick?: (logIndex: number) => void;
}

interface FileEntry {
  path: string;
  action: "created" | "modified";
  storyIndex: number;
}

export function DetailPane({ coordinationMessages, errors, selectedStoryIndex, onErrorClick }: DetailPaneProps) {
  // Derive files from coordination messages
  const files = useMemo(() => {
    const result: FileEntry[] = [];
    for (const msg of coordinationMessages) {
      if (msg.messageType !== "file_created" && msg.messageType !== "file_modified") continue;
      const storyIndex = (msg.metadata?.storyIndex as number) ?? -1;
      if (selectedStoryIndex !== null && storyIndex !== selectedStoryIndex) continue;
      const file = (msg.metadata?.file as string) ?? "";
      if (!file) continue;
      result.push({
        path: file,
        action: msg.messageType === "file_created" ? "created" : "modified",
        storyIndex,
      });
    }
    return result;
  }, [coordinationMessages, selectedStoryIndex]);

  // Group files by directory
  const groupedFiles = useMemo(() => {
    const groups = new Map<string, FileEntry[]>();
    for (const file of files) {
      const lastSlash = file.path.lastIndexOf("/");
      const dir = lastSlash >= 0 ? file.path.substring(0, lastSlash + 1) : "/";
      const group = groups.get(dir) ?? [];
      group.push(file);
      groups.set(dir, group);
    }
    return groups;
  }, [files]);

  const filteredErrors = useMemo(() => {
    // Show all errors (no story-level filtering for errors since they don't always have storyIndex)
    return errors;
  }, [errors]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Files Changed */}
      <div className="border-b border-border">
        <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Files Changed
          {files.length > 0 && (
            <span className="ml-1.5 text-foreground">{files.length}</span>
          )}
        </div>
        {files.length === 0 ? (
          <div className="px-3 pb-3 text-xs text-muted-foreground/60">No files yet</div>
        ) : (
          <div className="pb-1">
            {Array.from(groupedFiles.entries()).map(([dir, dirFiles]) => (
              <div key={dir}>
                <div className="px-3 py-0.5 text-[10px] text-muted-foreground/60 font-mono">{dir}</div>
                {dirFiles.map((file) => {
                  const fileName = file.path.substring(file.path.lastIndexOf("/") + 1);
                  return (
                    <div
                      key={file.path}
                      className="flex items-center gap-1.5 px-3 py-0.5 text-xs text-muted-foreground hover:bg-muted/30"
                    >
                      {file.action === "created" ? (
                        <FilePlus className="w-3 h-3 text-green-500 shrink-0" />
                      ) : (
                        <FileCode className="w-3 h-3 text-blue-500 shrink-0" />
                      )}
                      <span className="truncate font-mono">{fileName}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Errors */}
      <div>
        <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Errors
          {filteredErrors.length > 0 && (
            <span className="ml-1.5 text-red-400">{filteredErrors.length}</span>
          )}
        </div>
        {filteredErrors.length === 0 ? (
          <div className="px-3 pb-3 text-xs text-muted-foreground/60">No errors</div>
        ) : (
          <div className="pb-1 space-y-1">
            {filteredErrors.map((err, i) => (
              <button
                key={i}
                onClick={() => onErrorClick?.(err.logIndex)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  {err.type === "error" ? (
                    <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0" />
                  )}
                  <span
                    className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                      err.type === "error"
                        ? "bg-red-500/10 text-red-400"
                        : "bg-yellow-500/10 text-yellow-400"
                    }`}
                  >
                    {err.category}
                  </span>
                  {err.file && (
                    <span className="text-muted-foreground/60 font-mono truncate">
                      {err.file}
                      {err.line ? `:${err.line}` : ""}
                    </span>
                  )}
                </div>
                <div className="text-muted-foreground truncate pl-[18px]">{err.message}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
