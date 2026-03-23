import fs from "fs";
import path from "path";
const LOG_DIR = path.join(process.cwd(), ".workermill");
const LOG_FILE = path.join(LOG_DIR, "cli.log");
let logStream = null;
function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}
function getStream() {
    if (!logStream) {
        ensureLogDir();
        logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
    }
    return logStream;
}
function timestamp() {
    return new Date().toISOString();
}
export function log(level, message, data) {
    const entry = data
        ? `[${timestamp()}] ${level}: ${message} ${JSON.stringify(data)}`
        : `[${timestamp()}] ${level}: ${message}`;
    getStream().write(entry + "\n");
}
export function info(message, data) {
    log("INFO", message, data);
}
export function error(message, data) {
    log("ERROR", message, data);
}
export function debug(message, data) {
    log("DEBUG", message, data);
}
export function tool(toolName, input, result) {
    const inputPreview = JSON.stringify(input).slice(0, 200);
    const resultPreview = result ? result.slice(0, 200) : "";
    log("TOOL", `${toolName}`, { input: inputPreview, result: resultPreview });
}
export function flush() {
    if (logStream) {
        logStream.end();
        logStream = null;
    }
}
