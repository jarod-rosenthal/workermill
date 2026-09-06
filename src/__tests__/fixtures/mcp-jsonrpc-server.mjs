import readline from "node:readline";

const mode = process.argv[2] ?? "normal";
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
    return reply(request.id, { content: [{ type: "text", text: `${process.pid}:pong` }] });
  }
});
