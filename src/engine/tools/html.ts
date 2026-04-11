const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

const RAW_TEXT_TAGS = new Set(["script", "style", "noscript", "iframe", "object", "svg"]);

function parseTagName(tag: string): string {
  let i = 0;
  while (i < tag.length && (tag[i] === "/" || tag[i] === "!" || tag[i] === "?")) i++;
  const start = i;
  while (i < tag.length && /[a-zA-Z0-9:-]/.test(tag[i])) i++;
  return tag.slice(start, i).toLowerCase();
}

function findRawTextEnd(html: string, tagName: string, from: number): number {
  const lower = html.toLowerCase();
  const closeStart = lower.indexOf(`</${tagName}`, from);
  if (closeStart !== -1) {
    const closeEnd = lower.indexOf(">", closeStart);
    if (closeEnd === -1) return html.length;
    return closeEnd + 1;
  }
  return html.length;
}

function readAttribute(tag: string, attrName: string): string | null {
  const lower = tag.toLowerCase();
  const attr = attrName.toLowerCase();
  let idx = 0;

  while ((idx = lower.indexOf(attr, idx)) !== -1) {
    const before = idx === 0 ? " " : lower[idx - 1];
    const after = lower[idx + attr.length] ?? "";
    if (!/\s/.test(before) || !/[\s=]/.test(after)) {
      idx += attr.length;
      continue;
    }

    let pos = idx + attr.length;
    while (pos < tag.length && /\s/.test(tag[pos])) pos++;
    if (tag[pos] !== "=") {
      idx += attr.length;
      continue;
    }
    pos++;
    while (pos < tag.length && /\s/.test(tag[pos])) pos++;

    const quote = tag[pos];
    if (quote === '"' || quote === "'") {
      const end = tag.indexOf(quote, pos + 1);
      return end === -1 ? tag.slice(pos + 1) : tag.slice(pos + 1, end);
    }

    const start = pos;
    while (pos < tag.length && !/\s/.test(tag[pos])) pos++;
    return tag.slice(start, pos);
  }

  return null;
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g, (entity, decimal, hex, name) => {
    if (decimal || hex) {
      const codePoint = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      } catch {
        return entity;
      }
    }

    switch (name.toLowerCase()) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      case "nbsp":
        return " ";
      default:
        return entity;
    }
  });
}

function normalizeReadableText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToReadableText(html: string, format: "text" | "markdown" = "text"): string {
  const out: string[] = [];
  const linkStack: Array<string | null> = [];
  let i = 0;

  while (i < html.length) {
    if (html[i] !== "<") {
      const nextTag = html.indexOf("<", i);
      const end = nextTag === -1 ? html.length : nextTag;
      out.push(decodeHtmlEntities(html.slice(i, end)));
      i = end;
      continue;
    }

    if (html.startsWith("<!--", i)) {
      const commentEnd = html.indexOf("-->", i + 4);
      i = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }

    const tagEnd = html.indexOf(">", i + 1);
    if (tagEnd === -1) {
      out.push("<");
      i++;
      continue;
    }

    const rawTag = html.slice(i + 1, tagEnd).trim();
    const isClosing = rawTag.startsWith("/");
    const tagName = parseTagName(rawTag);

    if (!tagName) {
      i = tagEnd + 1;
      continue;
    }

    if (!isClosing && RAW_TEXT_TAGS.has(tagName)) {
      i = findRawTextEnd(html, tagName, tagEnd + 1);
      continue;
    }

    if (format === "markdown") {
      if (isClosing) {
        if (/^h[1-6]$/.test(tagName) || ["blockquote", "div", "li", "p", "pre", "tr"].includes(tagName)) out.push("\n");
        if (tagName === "strong" || tagName === "b") out.push("**");
        if (tagName === "em" || tagName === "i") out.push("*");
        if (tagName === "code") out.push("`");
        if (tagName === "pre") out.push("```\n");
        if (tagName === "a") {
          const href = linkStack.pop();
          if (href) out.push(` (${decodeHtmlEntities(href)})`);
        }
      } else {
        if (/^h[1-6]$/.test(tagName)) out.push(`\n${"#".repeat(Number(tagName[1]))} `);
        else if (tagName === "li") out.push("\n- ");
        else if (tagName === "blockquote") out.push("\n> ");
        else if (tagName === "pre") out.push("\n```\n");
        else if (tagName === "br") out.push("\n");
        else if (tagName === "hr") out.push("\n---\n");
        else if (BLOCK_TAGS.has(tagName)) out.push("\n");
        if (tagName === "strong" || tagName === "b") out.push("**");
        if (tagName === "em" || tagName === "i") out.push("*");
        if (tagName === "code") out.push("`");
        if (tagName === "a") linkStack.push(readAttribute(rawTag, "href"));
      }
    } else if (BLOCK_TAGS.has(tagName)) {
      out.push("\n");
    }

    i = tagEnd + 1;
  }

  return normalizeReadableText(out.join(""));
}
