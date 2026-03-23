import fs from "fs";
import path from "path";
import crypto from "crypto";
const SESSIONS_DIR = path.join(process.cwd(), ".workermill", "sessions");
function ensureSessionsDir() {
    if (!fs.existsSync(SESSIONS_DIR)) {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
}
export function createSession(provider, model) {
    return {
        id: crypto.randomUUID(),
        messages: [],
        provider,
        model,
        startedAt: new Date().toISOString(),
        totalTokens: 0,
    };
}
export function saveSession(session) {
    ensureSessionsDir();
    const filePath = path.join(SESSIONS_DIR, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
}
export function loadLatestSession() {
    ensureSessionsDir();
    try {
        const files = fs.readdirSync(SESSIONS_DIR)
            .filter(f => f.endsWith(".json"))
            .map(f => ({
            name: f,
            mtime: fs.statSync(path.join(SESSIONS_DIR, f)).mtimeMs,
        }))
            .sort((a, b) => b.mtime - a.mtime);
        if (files.length === 0)
            return null;
        const content = fs.readFileSync(path.join(SESSIONS_DIR, files[0].name), "utf-8");
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
export function addMessage(session, role, content) {
    session.messages.push({
        role,
        content,
        timestamp: new Date().toISOString(),
    });
}
export function listSessions(max = 20) {
    ensureSessionsDir();
    try {
        const files = fs.readdirSync(SESSIONS_DIR)
            .filter(f => f.endsWith(".json"))
            .map(f => ({
            name: f,
            mtime: fs.statSync(path.join(SESSIONS_DIR, f)).mtimeMs,
        }))
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, max);
        return files.map(f => {
            const content = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f.name), "utf-8"));
            const firstUserMsg = content.messages.find(m => m.role === "user");
            return {
                id: content.id,
                name: content.name,
                startedAt: content.startedAt,
                messageCount: content.messages.length,
                totalTokens: content.totalTokens,
                preview: firstUserMsg ? firstUserMsg.content.slice(0, 50) : "(empty)",
            };
        });
    }
    catch {
        return [];
    }
}
export function loadSessionById(id) {
    ensureSessionsDir();
    try {
        const filePath = path.join(SESSIONS_DIR, `${id}.json`);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, "utf-8"));
        }
        // Try partial ID match
        const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.startsWith(id));
        if (files.length === 1) {
            return JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, files[0]), "utf-8"));
        }
    }
    catch { /* ignore */ }
    return null;
}
export function deleteSession(id) {
    ensureSessionsDir();
    try {
        const filePath = path.join(SESSIONS_DIR, `${id}.json`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
    }
    catch { /* ignore */ }
    return false;
}
