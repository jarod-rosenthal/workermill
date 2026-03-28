import { mockGlobalFetch, restoreFetch } from "../helpers/mock-fetch.js";
import { createTempDir, cleanupTempDir } from "../helpers/temp-dir.js";
import { createToolDefinitions } from "../../tools/index.js";

const CTX = { toolCallId: "1", messages: [] as any[] };

describe("fetch tool", () => {
  let dir: string;
  let tools: ReturnType<typeof createToolDefinitions>;

  beforeEach(() => {
    dir = createTempDir("wm-fetch-");
    tools = createToolDefinitions(dir);
  });

  afterEach(() => {
    restoreFetch();
    cleanupTempDir(dir);
  });

  it("fetches text content", async () => {
    mockGlobalFetch({
      status: 200,
      body: "<html><body><p>Hello World</p></body></html>",
      headers: { "content-type": "text/html" },
    });
    const result = await tools.fetch.execute(
      { url: "https://example.com", format: "text" },
      CTX,
    );
    expect(result).toContain("Hello World");
    expect(result).toContain("example.com");
  });

  it("returns error for non-ok response", async () => {
    mockGlobalFetch({
      status: 404,
      statusText: "Not Found",
      ok: false,
      body: "",
    });
    const result = await tools.fetch.execute(
      { url: "https://example.com/missing" },
      CTX,
    );
    expect(result).toContain("Error");
    expect(result).toContain("404");
  });
});
