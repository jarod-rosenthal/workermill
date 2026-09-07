import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const temporaryRoots: string[] = [];
const indexPath = path.resolve(process.cwd(), "src/index.ts");

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "workermill-headless-cli-"));
  await symlink(path.resolve(process.cwd(), "node_modules"), path.join(root, "node_modules"), "dir");
  temporaryRoots.push(root);
  return root;
}

async function writeConfig(stateRoot: string): Promise<void> {
  await mkdir(stateRoot, { recursive: true });
  await writeFile(path.join(stateRoot, "cli.json"), JSON.stringify({
    providers: { test: { model: "offline-model" } },
    default: "test",
  }));
}

function invokeCli(cwd: string, stateRoot: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", indexPath, "run", "--json", ...args], {
    cwd,
    env: { ...process.env, WM_STATE_ROOT: stateRoot },
    encoding: "utf8",
    timeout: 5_000,
  });
}

function oneJson(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split("\n").filter(Boolean);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("headless CLI terminal results", () => {
  it("returns one JSON result for a missing prompt without interactive setup", async () => {
    const cwd = await temporaryRoot();
    const result = invokeCli(cwd, path.join(cwd, "state"), []);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(oneJson(result.stdout)).toMatchObject({ reason: "invalid_options", exitCode: 2 });
    expect(result.stderr).not.toContain("Welcome");
  });

  it.each(["1junk", "1.5"])("rejects invalid max steps %s before any model call", async (maxSteps) => {
    const cwd = await temporaryRoot();
    const stateRoot = path.join(cwd, "state");
    await writeConfig(stateRoot);

    const result = invokeCli(cwd, stateRoot, ["--max-steps", maxSteps, "offline"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(oneJson(result.stdout)).toMatchObject({ reason: "invalid_options", exitCode: 2 });
    expect(result.stderr).not.toContain("Welcome");
  });

  it("reports missing configuration as one JSON startup result", async () => {
    const cwd = await temporaryRoot();
    const result = invokeCli(cwd, path.join(cwd, "missing-state"), ["offline"]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(oneJson(result.stdout)).toMatchObject({ reason: "invalid_options", exitCode: 2 });
    expect(result.stderr).not.toContain("Welcome");
  });
});
