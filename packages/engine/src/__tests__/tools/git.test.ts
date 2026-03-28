import fs from "fs";
import path from "path";
import { createTempGitRepo, type TempGitRepo } from "../helpers/temp-git-repo.js";
import { createToolDefinitions } from "../../tools/index.js";

const CTX = { toolCallId: "1", messages: [] as any[] };

describe("git tool", () => {
  let repo: TempGitRepo;
  let tools: ReturnType<typeof createToolDefinitions>;

  beforeEach(() => {
    repo = createTempGitRepo({ "hello.txt": "hello world\n" });
    tools = createToolDefinitions(repo.dir, undefined, false);
  });

  afterEach(() => repo.cleanup());

  it("shows status", async () => {
    fs.writeFileSync(path.join(repo.dir, "new.txt"), "new file\n");
    const result = await tools.git.execute({ action: "status" }, CTX);
    expect(result).toContain("new.txt");
  });

  it("shows diff", async () => {
    fs.writeFileSync(path.join(repo.dir, "hello.txt"), "modified\n");
    const result = await tools.git.execute({ action: "diff" }, CTX);
    expect(result).toContain("modified");
  });

  it("shows log", async () => {
    const result = await tools.git.execute({ action: "log" }, CTX);
    expect(result).toContain("initial");
  });

  it("lists branches", async () => {
    const result = await tools.git.execute({ action: "branch" }, CTX);
    expect(result.includes("main") || result.includes("master")).toBe(true);
  });

  it("commits changes", async () => {
    fs.writeFileSync(path.join(repo.dir, "added.txt"), "content\n");
    await tools.git.execute({ action: "add", args: "added.txt" }, CTX);
    const result = await tools.git.execute({ action: "commit", args: "add file" }, CTX);
    expect(result).toContain("add file");
  });
});
