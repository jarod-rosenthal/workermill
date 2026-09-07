import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";

vi.mock("../logger.js", () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }));

let tmp: TempHome;
beforeEach(() => { tmp = createTempWorkerMillHome(); vi.resetModules(); });
afterEach(() => { vi.restoreAllMocks(); tmp.restore(); tmp.cleanup(); });

async function setup() {
  const storage = await import("../session.js");
  const commands = await import("../resume-command.js");
  const { getProjectSessionsDir } = await import("../project-data.js");
  const first = storage.createSession("ollama", "first");
  first.id = "abc-first";
  storage.addMessage(first, "user", "first conversation");
  storage.saveSession(first);
  const second = storage.createSession("ollama", "second");
  second.id = "abc-second";
  storage.addMessage(second, "user", "second conversation");
  storage.saveSession(second);
  fs.utimesSync(path.join(getProjectSessionsDir(), `${first.id}.json`), new Date(0), new Date(0));
  return { ...storage, ...commands, first, second, directory: getProjectSessionsDir() };
}

describe("resume selection", () => {
  it("resolves latest, exact and unique prefix while rejecting ambiguous or missing IDs", async () => {
    const api = await setup();
    expect(api.resolveResumeSession(undefined, true).id).toBe(api.second.id);
    expect(api.resolveResumeSession(api.first.id, false).messages[0].content).toBe("first conversation");
    expect(api.resolveResumeSession("abc-f", false).id).toBe(api.first.id);
    expect(() => api.resolveResumeSession("abc", false)).toThrow("Ambiguous");
    expect(() => api.resolveResumeSession("missing", false)).toThrow("not found");
    expect(() => api.resolveResumeSession("../outside", false)).toThrow("valid session ID");
    expect(() => api.resolveResumeSession(api.first.id, true)).toThrow("not both");
  });

  it("keeps valid sessions discoverable beside a corrupt save", async () => {
    const api = await setup();
    fs.writeFileSync(path.join(api.directory, "broken.json"), "{broken");
    expect(api.resumableSessions().map(session => session.id)).toEqual([api.second.id, api.first.id]);
    expect(api.resolveResumeSession(undefined, true).id).toBe(api.second.id);
  });

  it("preserves the last save if atomic replacement fails", async () => {
    const api = await setup();
    const before = fs.readFileSync(path.join(api.directory, `${api.first.id}.json`), "utf8");
    api.first.messages[0].content = "unsaved";
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("rename denied"); });
    expect(() => api.saveSession(api.first)).toThrow("rename denied");
    expect(fs.readFileSync(path.join(api.directory, `${api.first.id}.json`), "utf8")).toBe(before);
    expect(fs.readdirSync(api.directory).some(name => name.endsWith(".tmp"))).toBe(false);
  });

  it("forks selected history without replacing its saved original", async () => {
    const api = await setup();
    const selected = api.resolveResumeSession(api.first.id, false);
    const fork = api.forkSession(selected);
    api.addMessage(fork, "user", "new direction");
    api.saveSession(fork);
    expect(fork.id).not.toBe(selected.id);
    expect(api.loadSessionById(selected.id)?.messages).toHaveLength(1);
    expect(api.loadSessionById(fork.id)?.messages).toHaveLength(2);
  });
});
