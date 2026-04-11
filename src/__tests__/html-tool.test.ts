import { describe, expect, it } from "vitest";
import { htmlToReadableText } from "../engine/tools/html.js";

describe("htmlToReadableText", () => {
  it("extracts readable text and skips raw script/style content", () => {
    const html = `<main><h1>Title</h1><script>alert("x")</script ><style>body{}</style><p>Hello&nbsp;world</p></main>`;

    expect(htmlToReadableText(html, "text")).toBe("Title\n\nHello world");
  });

  it("decodes entities in a single pass", () => {
    expect(htmlToReadableText("&amp;lt;safe&amp;gt;", "text")).toBe("&lt;safe&gt;");
  });

  it("keeps basic markdown structure", () => {
    const html = `<h2>Docs</h2><p>Read <a href="https://example.com">the guide</a></p><ul><li>One</li><li>Two</li></ul>`;

    expect(htmlToReadableText(html, "markdown")).toContain("## Docs");
    expect(htmlToReadableText(html, "markdown")).toContain("the guide (https://example.com)");
    expect(htmlToReadableText(html, "markdown")).toContain("- One");
    expect(htmlToReadableText(html, "markdown")).toContain("- Two");
  });
});
