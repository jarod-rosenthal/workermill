import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStreamText = vi.fn();
vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
}));

describe("materializeProgramSubIssues", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = "test-token";
    process.env.GITHUB_REPO = "acme/repo";
  });

  it("creates child issues and patches parent body as top-level container", async () => {
    const decompositionJson = JSON.stringify({
      boardName: "Supplier Program",
      cards: [
        {
          title: "Extend supplier domain",
          description: "Update existing supplier service, routes, and tests",
          dependencyIndices: [],
          labels: ["backend"],
        },
        {
          title: "Supplier CRUD",
          description: "Add supplier endpoints",
          dependencyIndices: [0],
          labels: ["api"],
        },
      ],
    });

    mockStreamText.mockReturnValue({
      textStream: (async function* () {
        yield decompositionJson;
      })(),
      text: Promise.resolve(decompositionJson),
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ number: 201, html_url: "https://github.com/acme/repo/issues/201" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ number: 202, html_url: "https://github.com/acme/repo/issues/202" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
      });

    vi.stubGlobal("fetch", fetchMock);

    const { materializeProgramSubIssues } = await import("../program-bootstrap.js");

    const result = await materializeProgramSubIssues(
      {
        providers: { ollama: { model: "qwen3-coder:30b" } },
        default: "ollama",
        routing: { planner: "ollama" },
      },
      "#12",
      { title: "Parent", body: "Initial parent body" },
    );

    expect(result.epics).toEqual([
      { title: "Epic 1: Extend supplier domain", issueKeys: ["#201"] },
      { title: "Epic 2: Supplier CRUD", issueKeys: ["#202"] },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const parentPatchCall = fetchMock.mock.calls[2];
    expect(parentPatchCall[0]).toContain("/repos/acme/repo/issues/12");
    const patchBody = JSON.parse(String(parentPatchCall[1]?.body)) as { body: string };
    expect(patchBody.body).toContain("<!-- WORKERMILL_PROGRAM_START -->");
    expect(patchBody.body).toContain("- [ ] #201");
    expect(patchBody.body).toContain("- [ ] #202");
    expect(patchBody.body).toContain("depends on: #201");
  });
});
