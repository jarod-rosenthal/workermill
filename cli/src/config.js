import fs from "fs";
import path from "path";
import os from "os";
const CONFIG_DIR = path.join(os.homedir(), ".workermill");
const CONFIG_FILE = path.join(CONFIG_DIR, "cli.json");
export function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE))
            return null;
        const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function saveConfig(config) {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
export function loadProjectConfig() {
    try {
        const projectConfig = path.join(process.cwd(), ".workermill", "config.json");
        if (!fs.existsSync(projectConfig))
            return null;
        const raw = fs.readFileSync(projectConfig, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function resolveConfig() {
    const global = loadConfig();
    const project = loadProjectConfig();
    if (!global) {
        throw new Error("No configuration found. Run `workermill` to set up a provider.");
    }
    // Project config overrides global
    return {
        providers: { ...global.providers, ...(project?.providers || {}) },
        default: project?.default || global.default,
        routing: { ...global.routing, ...(project?.routing || {}) },
        mcp: { ...global.mcp, ...(project?.mcp || {}) },
        review: { ...global.review, ...(project?.review || {}) },
    };
}
export function getProviderForPersona(config, persona) {
    const providerName = (persona && config.routing?.[persona]) || config.default;
    const providerConfig = config.providers[providerName];
    if (!providerConfig) {
        throw new Error(`Provider "${providerName}" not found in configuration.`);
    }
    return {
        provider: providerName,
        model: providerConfig.model,
        apiKey: providerConfig.apiKey?.startsWith("{env:")
            ? process.env[providerConfig.apiKey.slice(5, -1)] || undefined
            : providerConfig.apiKey,
        host: providerConfig.host,
    };
}
