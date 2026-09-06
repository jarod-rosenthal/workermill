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
  if (request.method === "tools/list") return reply(request.id, { tools: [{ name: "ping", inputSchema: { type: "object" } }] });
  if (request.method === "tools/call") {
    if (mode === "hang-call") return;
    if (mode === "oversized-response") {
      return reply(request.id, { content: [{ type: "text", text: "x".repeat(8_192) }] });
    }
    if (mode === "orphan-after-start") {
      spawn(process.execPath, ["-e", `process.on("SIGTERM", () => {}); setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "late"), 500); setInterval(() => {}, 1_000);`], {
        stdio: "ignore",
      });
      process.exit(0);
    }
    return reply(request.id, { content: [{ type: "text", text: `${process.pid}:pong` }] });
  }
});
