import React from "react";
import { Box, Text } from "ink";
import { theme } from "./theme.js";
import type { ToolCallInfo } from "./types.js";

type DiffKind = "add" | "remove" | "context";

interface DiffLine {
  kind: DiffKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
  hunkHeader?: string;
}

interface EditedFilePreviewData {
  filePath: string;
  lines: DiffLine[];
  additions: number;
  removals: number;
}

const MAX_FILES = 2;
const MAX_LINES_PER_FILE = 14;
const MAX_RENDER_COLS = 100;

const previewPalette = {
  frameBorder: "#2D333B",
  frameHeaderBg: "#161B22",
  frameHeaderText: "#C9D1D9",
  gutterBg: "#0D1117",
  gutterText: "#6E7681",
  addBg: "#132A1C",
  removeBg: "#341B20",
  contextBg: "#10161C",
  addText: "#8AE296",
  removeText: "#FF8EA1",
  contextText: "#C9D1D9",
  hunkText: "#7AA2F7",
} as const;

function filePathFromInput(input: Record<string, unknown>): string {
  const raw = input.path ?? input.file_path ?? input.filePath;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "untitled";
}

function asLines(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  return value.replace(/\r\n/g, "\n").split("\n");
}

function parsePatchHunks(patchText: string): EditedFilePreviewData[] {
  const rows = patchText.replace(/\r\n/g, "\n").split("\n");
  const files: EditedFilePreviewData[] = [];
  let current: EditedFilePreviewData | null = null;
  let oldLine = 0;
  let newLine = 0;

  const ensureCurrent = (pathLabel?: string): EditedFilePreviewData => {
    if (!current) {
      current = {
        filePath: pathLabel || "patch",
        lines: [],
        additions: 0,
        removals: 0,
      };
      files.push(current);
      if (files.length > MAX_FILES) files.shift();
    } else if (pathLabel && current.filePath !== pathLabel) {
      current = {
        filePath: pathLabel,
        lines: [],
        additions: 0,
        removals: 0,
      };
      files.push(current);
      if (files.length > MAX_FILES) files.shift();
    }
    return current;
  };

  for (const row of rows) {
    const plusPath = row.match(/^\+\+\+\s+(?:[ab]\/)?(.+)$/);
    if (plusPath) {
      current = {
        filePath: plusPath[1].trim() || "patch",
        lines: [],
        additions: 0,
        removals: 0,
      };
      files.push(current);
      if (files.length > MAX_FILES) files.shift();
      continue;
    }

    const hunk = row.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      const target = ensureCurrent();
      if (target.lines.length < MAX_LINES_PER_FILE) {
        target.lines.push({
          kind: "context",
          text: row,
          oldLine: null,
          newLine: null,
          hunkHeader: row,
        });
      }
      continue;
    }

    if (!row || row.startsWith("diff ") || row.startsWith("--- ")) continue;
    if (!["+", "-", " "].includes(row[0])) continue;
    if (row.startsWith("+++ ") || row.startsWith("--- ")) continue;

    const target = ensureCurrent();
    if (target.lines.length >= MAX_LINES_PER_FILE) continue;

    if (row[0] === "+") {
      target.lines.push({ kind: "add", text: row.slice(1), oldLine: null, newLine });
      target.additions += 1;
      newLine += 1;
      continue;
    }
    if (row[0] === "-") {
      target.lines.push({ kind: "remove", text: row.slice(1), oldLine, newLine: null });
      target.removals += 1;
      oldLine += 1;
      continue;
    }

    target.lines.push({ kind: "context", text: row.slice(1), oldLine, newLine });
    oldLine += 1;
    newLine += 1;
  }

  return files.filter((f) => f.lines.length > 0);
}

export function buildEditedFilePreviews(toolCalls: ToolCallInfo[]): EditedFilePreviewData[] {
  const previews: EditedFilePreviewData[] = [];

  for (const call of toolCalls) {
    if (previews.length >= MAX_FILES) break;
    if (call.status !== "done") continue;

    if (call.name === "patch") {
      const patchText = call.input.patch_text;
      if (typeof patchText === "string" && patchText.trim()) {
        const parsed = parsePatchHunks(patchText).slice(0, MAX_FILES - previews.length);
        previews.push(...parsed);
      }
      continue;
    }

    if (call.name === "edit_file") {
      const filePath = filePathFromInput(call.input);
      const oldLines = asLines(call.input.old_string);
      const newLines = asLines(call.input.new_string);
      const lines: DiffLine[] = [];

      for (let i = 0; i < oldLines.length && lines.length < MAX_LINES_PER_FILE; i++) {
        lines.push({ kind: "remove", text: oldLines[i], oldLine: i + 1, newLine: null });
      }
      for (let i = 0; i < newLines.length && lines.length < MAX_LINES_PER_FILE; i++) {
        lines.push({ kind: "add", text: newLines[i], oldLine: null, newLine: i + 1 });
      }

      if (lines.length > 0) {
        previews.push({
          filePath,
          lines,
          additions: newLines.length,
          removals: oldLines.length,
        });
      }
      continue;
    }

    if (call.name === "write_file") {
      const filePath = filePathFromInput(call.input);
      const content = asLines(call.input.content);
      if (content.length === 0) continue;

      const lines: DiffLine[] = content.slice(0, MAX_LINES_PER_FILE).map((text, index) => ({
        kind: "add",
        text,
        oldLine: null,
        newLine: index + 1,
      }));

      previews.push({
        filePath,
        lines,
        additions: content.length,
        removals: 0,
      });
    }
  }

  return previews.slice(0, MAX_FILES);
}

function lineColor(kind: DiffKind): string {
  if (kind === "add") return previewPalette.addText;
  if (kind === "remove") return previewPalette.removeText;
  return previewPalette.contextText;
}

function rowBackground(kind: DiffKind): string {
  if (kind === "add") return previewPalette.addBg;
  if (kind === "remove") return previewPalette.removeBg;
  return previewPalette.contextBg;
}

function lineMarker(kind: DiffKind): string {
  if (kind === "add") return "+";
  if (kind === "remove") return "-";
  return " ";
}

function padLineNumber(value: number | null): string {
  if (value == null) return "   ";
  return String(value).padStart(3, " ");
}

function clampLine(text: string): string {
  if (text.length <= MAX_RENDER_COLS) return text;
  return `${text.slice(0, MAX_RENDER_COLS - 1)}…`;
}

export function EditedFilePreview({ toolCalls }: { toolCalls: ToolCallInfo[] }): React.ReactElement | null {
  const previews = buildEditedFilePreviews(toolCalls);
  if (previews.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      {previews.map((preview, index) => (
        <Box key={`${preview.filePath}-${index}`} flexDirection="column" marginBottom={1}>
          <Box marginBottom={0}>
            <Text color={theme.subtle}>Edited file</Text>
            <Text color={theme.subtleDark}> {"▾"}</Text>
          </Box>
          <Box borderStyle="round" borderColor={previewPalette.frameBorder} flexDirection="column">
            <Box paddingX={1}>
              <Text backgroundColor={previewPalette.frameHeaderBg} color={previewPalette.frameHeaderText} bold>
                {preview.filePath}
              </Text>
              <Text backgroundColor={previewPalette.frameHeaderBg} color={previewPalette.addText}> {" +"}{preview.additions}</Text>
              <Text backgroundColor={previewPalette.frameHeaderBg} color={previewPalette.removeText}> {" -"}{preview.removals}</Text>
            </Box>
            {preview.lines.map((line, lineIndex) => (
              <Box key={`${preview.filePath}-line-${lineIndex}`}>
                <Text backgroundColor={previewPalette.gutterBg} color={previewPalette.gutterText}>
                  {" "}{padLineNumber(line.oldLine)}{" "}
                </Text>
                <Text backgroundColor={previewPalette.gutterBg} color={previewPalette.gutterText}>
                  {padLineNumber(line.newLine)}{" "}
                </Text>
                {line.hunkHeader ? (
                  <Text backgroundColor={previewPalette.contextBg} color={previewPalette.hunkText}>
                    {clampLine(line.hunkHeader)}
                  </Text>
                ) : (
                  <Text backgroundColor={rowBackground(line.kind)} color={lineColor(line.kind)}>
                    {lineMarker(line.kind)} {clampLine(line.text || " ")}
                  </Text>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
