import { mockGlobalFetch, restoreFetch } from "../helpers/mock-fetch.js";
import { execute } from "../../tools/web-search.js";

describe("web-search tool", () => {
  afterEach(() => restoreFetch());

  const FAKE_HTML = `
    <div class="result">
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">
        <b>Example</b> Docs
      </a>
      <a class="result__snippet">A snippet about the example docs page.</a>
    </div>
    <div class="result">
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fother.dev%2Fguide">
        Other Guide
      </a>
      <a class="result__snippet">Another snippet for the guide.</a>
    </div>
  `;

  it("returns parsed results from DuckDuckGo HTML", async () => {
    mockGlobalFetch({ body: FAKE_HTML });
    const result = await execute({ query: "example docs" });
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results![0].title).toBe("Example Docs");
    expect(result.results![0].url).toBe("https://example.com/docs");
    expect(result.results![0].snippet).toBe("A snippet about the example docs page.");
    expect(result.results![1].url).toBe("https://other.dev/guide");
  });

  it("respects maxResults", async () => {
    mockGlobalFetch({ body: FAKE_HTML });
    const result = await execute({ query: "example", maxResults: 1 });
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
  });

  it("returns empty results when HTML has no matches", async () => {
    mockGlobalFetch({ body: "<html><body>No results here</body></html>" });
    const result = await execute({ query: "nonexistent" });
    expect(result.success).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.error).toBe("No results found");
  });

  it("handles HTTP error status", async () => {
    mockGlobalFetch({ status: 503, ok: false, body: "Service Unavailable" });
    const result = await execute({ query: "test" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("HTTP 503");
  });

  it("handles fetch rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network error"); }));
    const result = await execute({ query: "test" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Network error");
  });

  it("extracts direct URLs when uddg param is absent", async () => {
    const html = `
      <a class="result__a" href="https://direct.example.com/page">Direct Title</a>
      <a class="result__snippet">Direct snippet.</a>
    `;
    mockGlobalFetch({ body: html });
    const result = await execute({ query: "direct" });
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results![0].url).toBe("https://direct.example.com/page");
  });
});
