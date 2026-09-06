import { afterEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

const state = vi.hoisted(() => ({
  session: {
    id: "resume", provider: "test", model: "scripted", messages: [], startedAt: "now", updatedAt: "now",
    totalTokens: 100, totalCostUsd: 0.5,
    usageLedger: {
      calls: [{ callId: "previous", persona: "run", provider: "test", model: "scripted", usage: { inputTokens: 60, outputTokens: 40 }, usageState: "reported", pricingState: "known", estimatedApiCost: 0.5 }],
      totals: { callCount: 1, reportedUsageCalls: 1, partialUsageCalls: 0, missingUsageCalls: 0, knownPricingCalls: 1, unknownPricingCalls: 0, localApiCalls: 0, inputTokens: 60, outputTokens: 40, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedApiCost: 0.5 },
    },
  },
  saved: undefined as unknown,
}));

vi.mock("../engine/model-factory.js", () => ({ createModel: vi.fn(() => ({})), buildOllamaOptions: vi.fn(() => ({})) }));
vi.mock("../session.js", () => ({
  createSession: vi.fn(() => state.session), loadSessionById: vi.fn(() => state.session), loadLatestSession: vi.fn(() => state.session),
  addMessage: vi.fn(), saveSession: vi.fn((session) => { state.saved = structuredClone(session); }),
}));
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), streamText: vi.fn() }));

import { streamText } from "ai";
import { runCommand } from "../run-command.js";
import type { CliConfig } from "../config.js";

const config: CliConfig = { providers: { test: { model: "scripted" } }, default: "test" };

describe("headless usage ledger", () => {
  let workspace: string;

  afterEach(async () => { if (workspace) await rm(workspace, { recursive: true, force: true }); vi.mocked(streamText).mockReset(); });

  it("keeps prior resumed-session totals while appending this run's observed ledger", async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "workermill-headless-ledger-"));
    vi.mocked(streamText).mockImplementation(() => ({
      textStream: (async function* () { yield "done"; })(), text: Promise.resolve("done"),
      totalUsage: Promise.resolve({ inputTokens: 7, outputTokens: 3 }), finishReason: Promise.resolve("stop"), steps: Promise.resolve([]),
    }) as never);

    const result = await runCommand({ prompt: "resume", session: "resume" }, config, workspace);

    expect(result).toMatchObject({ status: "ok", tokens: { input: 7, output: 3 }, usageComplete: true });
    expect(state.saved).toMatchObject({
      totalTokens: 110, totalCostUsd: 0.5,
      usageLedger: { totals: { callCount: 2, inputTokens: 67, outputTokens: 43 } },
    });
  });
});
