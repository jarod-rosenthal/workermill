import React from "react";
import { Box, Text } from "ink";
import { theme, syntax } from "./theme.js";

/**
 * Basic syntax highlighting for code block lines.
 * Applies colors for keywords, strings, comments, types, and numbers.
 */
function highlightCode(line: string, lang: string): React.ReactElement[] {
  const parts: React.ReactElement[] = [];
  let remaining = line;
  let idx = 0;

  // Comment detection (single-line)
  const commentPatterns = [/^(\s*\/\/.*)/, /^(\s*#.*)/, /^(\s*--.*)/, /^(\s*\/\*.*\*\/)/];
  for (const cp of commentPatterns) {
    const cm = remaining.match(cp);
    if (cm) {
      return [<Text key={`c-${idx}`} color={syntax.comment}>{remaining}</Text>];
    }
  }

  // String literals
  const stringRe = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/;
  // Keywords (common across languages)
  const keywordRe = /\b(import|export|from|const|let|var|function|class|interface|type|return|if|else|for|while|do|switch|case|break|continue|new|this|super|extends|implements|async|await|try|catch|finally|throw|typeof|instanceof|in|of|as|default|void|null|undefined|true|false|def|fn|pub|mod|use|struct|enum|impl|trait|match|self|mut|ref|where|crate|macro|move|loop|static|extern|unsafe|dyn)\b/;
  // Type-like patterns (PascalCase)
  const typeRe = /\b([A-Z][a-zA-Z0-9]+)\b/;
  // Numbers
  const numberRe = /\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/;

  while (remaining.length > 0) {
    // Find earliest match among patterns
    const candidates: Array<{ type: string; match: RegExpExecArray; pos: number }> = [];

    const sm = stringRe.exec(remaining);
    if (sm) candidates.push({ type: "string", match: sm, pos: sm.index });

    const km = keywordRe.exec(remaining);
    if (km) candidates.push({ type: "keyword", match: km, pos: km.index });

    const tm = typeRe.exec(remaining);
    if (tm) candidates.push({ type: "type", match: tm, pos: tm.index });

    const nm = numberRe.exec(remaining);
    if (nm) candidates.push({ type: "number", match: nm, pos: nm.index });

    candidates.sort((a, b) => a.pos - b.pos);
    const winner = candidates[0];

    if (!winner) {
      parts.push(<Text key={`d-${idx++}`} color={syntax.default}>{remaining}</Text>);
      break;
    }

    // Text before match
    if (winner.pos > 0) {
      parts.push(
        <Text key={`d-${idx++}`} color={syntax.default}>
          {remaining.slice(0, winner.pos)}
        </Text>,
      );
    }

    const matchStr = winner.type === "string" ? winner.match[0] : winner.match[1];
    const fullMatch = winner.type === "string" ? winner.match[0] : winner.match[0];
    const color = winner.type === "string"
      ? syntax.string
      : winner.type === "keyword"
        ? syntax.keyword
        : winner.type === "type"
          ? syntax.type
          : syntax.number;

    parts.push(
      <Text key={`h-${idx++}`} color={color}>
        {matchStr}
      </Text>,
    );

    // For keywords/types/numbers the match[0] may include word boundary context
    remaining = remaining.slice(winner.pos + fullMatch.length);
  }

  return parts;
}

/** Parse inline markdown formatting and return an array of Ink Text elements. */
function renderInline(line: string, key: string): React.ReactElement {
  const parts: React.ReactElement[] = [];
  let remaining = line;
  let idx = 0;

  while (remaining.length > 0) {
    // Bold: **text** or __text__
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/);
    const boldMatch2 = remaining.match(/^(.*?)__(.+?)__/);
    const bold = boldMatch && (!boldMatch2 || boldMatch.index! <= boldMatch2.index!)
      ? boldMatch
      : boldMatch2;

    // Inline code: `text`
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`/);

    // Pick whichever match comes first
    type Match = RegExpMatchArray | null;
    const candidates: { type: string; match: Match; pos: number }[] = [];
    if (bold) candidates.push({ type: "bold", match: bold, pos: bold[1].length });
    if (codeMatch) candidates.push({ type: "code", match: codeMatch, pos: codeMatch[1].length });

    candidates.sort((a, b) => a.pos - b.pos);
    const winner = candidates[0];

    if (!winner) {
      parts.push(<Text key={`${key}-${idx++}`} color={theme.text}>{remaining}</Text>);
      break;
    }

    const m = winner.match!;
    // Text before the match
    if (m[1]) {
      parts.push(<Text key={`${key}-${idx++}`} color={theme.text}>{m[1]}</Text>);
    }

    if (winner.type === "bold") {
      parts.push(<Text key={`${key}-${idx++}`} bold color={theme.text}>{m[2]}</Text>);
    } else {
      // Inline code in ice blue
      parts.push(<Text key={`${key}-${idx++}`} color={theme.iceBlue}>{m[2]}</Text>);
    }

    remaining = remaining.slice(m[0].length);
  }

  if (parts.length === 0) {
    return <Text key={key}>{" "}</Text>;
  }

  return <Text key={key}>{parts}</Text>;
}

/** Render a fenced code block as a bordered box with syntax highlighting. */
function renderCodeBlock(
  lines: string[],
  lang: string,
  key: string,
): React.ReactElement {
  return (
    <Box key={key} flexDirection="column" marginLeft={1} marginY={0}>
      {lang && <Text color={theme.subtle}>{`  ${lang}`}</Text>}
      <Box
        borderStyle="round"
        borderColor={theme.subtleDark}
        paddingX={1}
        flexDirection="column"
      >
        {lines.map((codeLine, i) => (
          <Text key={`${key}-code-${i}`}>
            {highlightCode(codeLine || " ", lang)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

interface MarkdownProps {
  content: string;
  /** Terminal columns available for this message. Used to constrain text width at render time. */
  width?: number;
}

/**
 * Renders markdown content as Ink components with Claude Code styling.
 *
 * Supported syntax: headers, fenced code blocks (with syntax highlighting),
 * bullet lists, bold, inline code, blockquotes, and horizontal rules.
 */
export function Markdown({ content, width }: MarkdownProps): React.ReactElement {
  const sourceLines = content.split("\n");
  const elements: React.ReactElement[] = [];
  let i = 0;
  let elemKey = 0;

  while (i < sourceLines.length) {
    const line = sourceLines[i];

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || "";
      const codeLines: string[] = [];
      i++;
      while (i < sourceLines.length && !sourceLines[i].startsWith("```")) {
        codeLines.push(sourceLines[i]);
        i++;
      }
      // Skip closing fence
      if (i < sourceLines.length) i++;
      elements.push(renderCodeBlock(codeLines, lang, `block-${elemKey++}`));
      continue;
    }

    // Horizontal rule
    if (/^(---|\*\*\*|___)/.test(line.trim())) {
      elements.push(
        <Text key={`hr-${elemKey++}`} color={theme.subtleDark}>
          {"\u2500".repeat(60)}
        </Text>,
      );
      i++;
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      const depth = headerMatch[1].length;
      const text = headerMatch[2];
      elements.push(
        <Text
          key={`h-${elemKey++}`}
          bold
          color={depth <= 2 ? theme.text : theme.subtle}
        >
          {text}
        </Text>,
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const quoteText = line.replace(/^>\s?/, "");
      elements.push(
        <Box key={`bq-${elemKey++}`}>
          <Text color={theme.subtleDark}>{"  \u2502 "}</Text>
          <Text color={theme.subtle}>{quoteText}</Text>
        </Box>,
      );
      i++;
      continue;
    }

    // Unordered list
    const listMatch = line.match(/^(\s*)[-*]\s+(.*)/);
    if (listMatch) {
      const indent = listMatch[1] || "";
      const text = listMatch[2];
      elements.push(
        <Box key={`li-${elemKey++}`}>
          <Text color={theme.subtle}>
            {indent}{"  "}{"\u2022 "}
          </Text>
          {renderInline(text, `li-inline-${elemKey}`)}
        </Box>,
      );
      i++;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
    if (olMatch) {
      const indent = olMatch[1] || "";
      const text = olMatch[2];
      const numMatch = line.match(/^(\s*)(\d+)\./);
      const num = numMatch ? numMatch[2] : "1";
      elements.push(
        <Box key={`ol-${elemKey++}`}>
          <Text color={theme.subtle}>
            {indent}{"  "}{num}{". "}
          </Text>
          {renderInline(text, `ol-inline-${elemKey}`)}
        </Box>,
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      elements.push(<Text key={`empty-${elemKey++}`}>{" "}</Text>);
      i++;
      continue;
    }

    // Regular paragraph line
    elements.push(
      <Box key={`p-${elemKey++}`}>
        {renderInline(line, `inline-${elemKey}`)}
      </Box>,
    );
    i++;
  }

  return (
    <Box flexDirection="column" width={width}>
      {elements}
    </Box>
  );
}
