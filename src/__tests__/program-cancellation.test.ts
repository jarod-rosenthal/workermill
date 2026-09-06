import { afterEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ streamText: vi.fn() }));
vi.mock("ai", () => sdk);
vi.mock("../engine/model-factory.js", () => ({ createModel: vi.fn(() => ({})) }));
import { decomposeParentIssue, materializeProgramSubIssues } from "../program-bootstrap.js";
import type { CliConfig } from "../config.js";
const config: CliConfig = { providers: { ollama: { model: "test" } }, default: "ollama" };
const parent = { title: "Extend existing behavior", body: "Update existing code." };
const decomposition = { boardName: "Fixture", cards: [
  { title: "First", description: "Extend existing code", dependencyIndices: [], labels: [] },
  { title: "Second", description: "Extend existing code", dependencyIndices: [0], labels: [] },
] };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("program cancellation", () => {
  it("does not start decomposition or issue creation after cancellation", async () => {
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(decomposeParentIssue(config, parent, undefined, controller.signal)).rejects.toThrow("cancelled");
    await expect(materializeProgramSubIssues(config, "#1", parent, undefined, decomposition, controller.signal)).rejects.toThrow("cancelled");
    expect(sdk.streamText).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts an active decomposition stream", async () => {
    const controller = new AbortController();
    sdk.streamText.mockImplementation((options: { abortSignal: AbortSignal }) => ({
      textStream: (async function* () {
        yield "partial";
        await new Promise<void>((_, reject) => options.abortSignal.addEventListener("abort", () => reject(options.abortSignal.reason), { once: true }));
      })(), text: Promise.resolve("partial"),
    }));
    const running = decomposeParentIssue(config, parent, undefined, controller.signal);
    await new Promise<void>(resolve => setImmediate(resolve));
    controller.abort(new Error("cancelled stream"));
    await expect(running).rejects.toThrow("cancelled stream");
    expect(sdk.streamText.mock.calls[0][0].abortSignal).toBe(controller.signal);
  });

  it("cancels a started issue request and never creates the next issue or patches the parent", async () => {
    vi.stubEnv("GITHUB_TOKEN", "fixture"); vi.stubEnv("GITHUB_REPO", "fixture/repo");
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal;
      return new Promise<Response>((_, reject) => requestSignal!.addEventListener("abort", () => reject(requestSignal!.reason), { once: true }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const running = materializeProgramSubIssues(config, "#1", parent, undefined, decomposition, controller.signal);
    expect(fetchMock).toHaveBeenCalledOnce();
    controller.abort(new Error("cancelled request"));
    await expect(running).rejects.toThrow("cancelled request");
    expect(requestSignal?.aborted).toBe(true); expect(fetchMock).toHaveBeenCalledOnce();
  });
});
