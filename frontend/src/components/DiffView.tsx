import { useMemo } from "react";
import { diffLines, type Change } from "diff";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface DiffViewProps {
  before: string;
  after: string;
  language: string;
  viewMode: "unified" | "split";
}

interface DiffLine {
  text: string;
  type: "added" | "removed" | "unchanged";
  oldLineNo: number | null;
  newLineNo: number | null;
}

function computeDiffLines(before: string, after: string): DiffLine[] {
  const changes: Change[] = diffLines(before, after);
  const lines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const change of changes) {
    // Split into individual lines, removing trailing empty from final newline
    const rawLines = change.value.split("\n");
    if (rawLines[rawLines.length - 1] === "") rawLines.pop();

    for (const text of rawLines) {
      if (change.added) {
        lines.push({ text, type: "added", oldLineNo: null, newLineNo: newLine++ });
      } else if (change.removed) {
        lines.push({ text, type: "removed", oldLineNo: oldLine++, newLineNo: null });
      } else {
        lines.push({ text, type: "unchanged", oldLineNo: oldLine++, newLineNo: newLine++ });
      }
    }
  }

  return lines;
}

const highlighterStyle = {
  margin: 0,
  padding: 0,
  borderRadius: 0,
  fontSize: "0.75rem",
  lineHeight: "1.4",
  background: "transparent",
};

function HighlightedLine({ text, language }: { text: string; language: string }) {
  return (
    <SyntaxHighlighter
      language={language}
      style={oneDark}
      customStyle={highlighterStyle}
      PreTag="span"
      CodeTag="span"
      wrapLines={false}
    >
      {text || " "}
    </SyntaxHighlighter>
  );
}

const gutterStyle = "w-10 flex-shrink-0 text-right pr-2 select-none text-[10px] leading-[1.4] font-mono";
const gutterColor = "text-white/20";

function UnifiedView({ lines, language }: { lines: DiffLine[]; language: string }) {
  return (
    <div className="font-mono text-xs">
      {lines.map((line, i) => {
        const bg =
          line.type === "added"
            ? "bg-green-950/30"
            : line.type === "removed"
              ? "bg-red-950/30"
              : "";
        const prefix =
          line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
        const prefixColor =
          line.type === "added"
            ? "text-green-400"
            : line.type === "removed"
              ? "text-red-400"
              : "text-white/20";

        return (
          <div key={i} className={`flex ${bg}`}>
            <span className={`${gutterStyle} ${gutterColor}`}>
              {line.oldLineNo ?? ""}
            </span>
            <span className={`${gutterStyle} ${gutterColor}`}>
              {line.newLineNo ?? ""}
            </span>
            <span className={`w-4 flex-shrink-0 text-center select-none ${prefixColor}`}>
              {prefix}
            </span>
            <span className="flex-1 min-w-0 whitespace-pre-wrap break-all" style={{ fontSize: "0.75rem", lineHeight: "1.4" }}>
              <HighlightedLine text={line.text} language={language} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SplitView({ lines, language }: { lines: DiffLine[]; language: string }) {
  // Build left (removed + unchanged) and right (added + unchanged) columns
  const left: (DiffLine | null)[] = [];
  const right: (DiffLine | null)[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === "unchanged") {
      left.push(line);
      right.push(line);
      i++;
    } else if (line.type === "removed") {
      // Collect consecutive removed, then pair with consecutive added
      const removedStart = i;
      while (i < lines.length && lines[i].type === "removed") i++;
      const addedStart = i;
      while (i < lines.length && lines[i].type === "added") i++;

      const removedCount = addedStart - removedStart;
      const addedCount = i - addedStart;
      const maxCount = Math.max(removedCount, addedCount);

      for (let j = 0; j < maxCount; j++) {
        left.push(j < removedCount ? lines[removedStart + j] : null);
        right.push(j < addedCount ? lines[addedStart + j] : null);
      }
    } else {
      // Added without preceding removed
      left.push(null);
      right.push(line);
      i++;
    }
  }

  return (
    <div className="font-mono text-xs flex">
      {/* Left side (before) */}
      <div className="flex-1 min-w-0 border-r border-border/30">
        {left.map((line, idx) => {
          const bg = line?.type === "removed" ? "bg-red-950/30" : "";
          return (
            <div key={idx} className={`flex ${bg}`} style={{ minHeight: "1.4em" }}>
              <span className={`${gutterStyle} ${gutterColor}`}>
                {line?.oldLineNo ?? ""}
              </span>
              <span className="flex-1 min-w-0 whitespace-pre-wrap break-all" style={{ fontSize: "0.75rem", lineHeight: "1.4" }}>
                {line ? <HighlightedLine text={line.text} language={language} /> : " "}
              </span>
            </div>
          );
        })}
      </div>
      {/* Right side (after) */}
      <div className="flex-1 min-w-0">
        {right.map((line, idx) => {
          const bg = line?.type === "added" ? "bg-green-950/30" : "";
          return (
            <div key={idx} className={`flex ${bg}`} style={{ minHeight: "1.4em" }}>
              <span className={`${gutterStyle} ${gutterColor}`}>
                {line?.newLineNo ?? ""}
              </span>
              <span className="flex-1 min-w-0 whitespace-pre-wrap break-all" style={{ fontSize: "0.75rem", lineHeight: "1.4" }}>
                {line ? <HighlightedLine text={line.text} language={language} /> : " "}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DiffView({ before, after, language, viewMode }: DiffViewProps) {
  const lines = useMemo(() => computeDiffLines(before, after), [before, after]);

  if (lines.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No changes to display
      </div>
    );
  }

  return viewMode === "split" ? (
    <SplitView lines={lines} language={language} />
  ) : (
    <UnifiedView lines={lines} language={language} />
  );
}
