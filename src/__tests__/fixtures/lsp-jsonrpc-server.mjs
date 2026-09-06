import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [mode = "normal", marker] = process.argv.slice(2);

if (mode === "write-marker") {
  if (marker) writeFileSync(marker, "spawned");
  process.exit(0);
}

if (mode === "late-child") {
  process.on("SIGTERM", () => {
    // The fixture proves the owner escalates TERM to KILL for descendants.
  });
  if (marker) writeFileSync(marker, String(process.pid));
  process.send?.({ ready: true });
  setInterval(() => {}, 1_000);
}

let buffer = Buffer.alloc(0);

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function handle(message) {
  if (message.method === "initialize") {
    if (mode === "hang-initialize") {
      if (marker) writeFileSync(`${marker}.initialize`, "started");
      return;
    }
    send({ jsonrpc: "2.0", id: message.id, result: { capabilities: { diagnosticProvider: {} } } });
    return;
  }
  if (typeof message.id !== "number") return;
  if (mode === "hang-request") {
    if (marker) writeFileSync(`${marker}.request`, "started");
    return;
  }
  if (mode === "orphan-after-ready") {
    const child = spawn(process.execPath, [new URL(import.meta.url).pathname, "late-child", marker], {
      detached: false,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    child.once("message", (ready) => {
      if (ready?.ready) process.exit(0);
    });
    return;
  }
  if (mode === "oversized-response") {
    send({ jsonrpc: "2.0", id: message.id, result: "x".repeat(4096) });
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    send({ jsonrpc: "2.0", id: message.id, result: [{ name: "fixtureSymbol", kind: 12, range: { start: { line: 0 } } }] });
    return;
  }
  if (message.method === "textDocument/diagnostic") {
    send({ jsonrpc: "2.0", id: message.id, result: { items: [] } });
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, result: [] });
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const boundary = buffer.indexOf("\r\n\r\n");
    if (boundary < 0) return;
    const header = buffer.subarray(0, boundary).toString();
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.subarray(boundary + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = boundary + 4;
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString();
    buffer = buffer.subarray(start + length);
    handle(JSON.parse(body));
  }
});
