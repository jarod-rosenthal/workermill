import readline from "node:readline";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const mode = process.argv[2] ?? "normal";
const marker = process.argv[3];

if (mode === "write-marker" && marker) writeFileSync(marker, "spawned");
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

input.on("line", (line) => {
  const request = JSON.parse(line);
  if (mode === "hang-initialize" && request.method === "initialize") return;
  if (request.method === "initialize") return reply(request.id, { capabilities: {}, serverInfo: { name: "fixture" } });
  if (request.method === "tools/list") {
    if (mode === "schema") return reply(request.id, { tools: [{ name: "do:something!", description: "Schema fixture", inputSchema: { type: "string", properties: "invalid" } }] });
    if (mode === "github-issues") {
      return reply(request.id, {
        tools: [{
          name: "list_issues",
          inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" } } },
        }],
      });
    }
    return reply(request.id, { tools: [{ name: "ping", inputSchema: { type: "object" } }] });
  }
  if (request.method === "tools/call") {
    if (mode === "hang-call") return;
    if (mode === "oversized-response") {
      return reply(request.id, { content: [{ type: "text", text: "x".repeat(8_192) }] });
    }
    if (mode === "rich-content") {
      return reply(request.id, { content: [{ type: "text", text: "line one" }, { type: "image", data: "image" }, { type: "text", text: "line two" }] });
    }
    if (mode === "github-issues") {
      return reply(request.id, { content: [{ type: "text", text: JSON.stringify(request.params.arguments) }] });
    }
    if (mode === "orphan-after-start") {
      const child = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(process.argv[1] + ".started", String(process.pid)); process.send("ready"); setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "late"), 500); setInterval(() => {}, 1_000);', marker], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      child.once("message", () => process.exit(0));
      return;
    }
    return reply(request.id, { content: [{ type: "text", text: `${process.pid}:pong` }] });
  }
});
