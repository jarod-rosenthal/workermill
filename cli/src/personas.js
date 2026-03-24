import fs from "fs";
import path from "path";
import os from "os";
function parsePersonaFile(content) {
    // Parse YAML frontmatter between --- markers
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match)
        return null;
    const frontmatter = match[1];
    const body = match[2].trim();
    // Simple YAML parser for flat keys
    const meta = {};
    for (const line of frontmatter.split("\n")) {
        const kvMatch = line.match(/^(\w+):\s*(.+)$/);
        if (kvMatch) {
            const key = kvMatch[1];
            let value = kvMatch[2].trim();
            // Parse arrays like [a, b, c]
            if (value.startsWith("[") && value.endsWith("]")) {
                value = value.slice(1, -1).split(",").map((s) => s.trim());
            }
            meta[key] = value;
        }
    }
    if (!meta.name || !meta.slug)
        return null;
    return {
        name: meta.name,
        slug: meta.slug,
        description: meta.description || "",
        tools: meta.tools || ["bash", "read_file", "write_file", "edit_file", "patch", "glob", "grep", "ls", "fetch", "sub_agent"],
        provider: meta.provider,
        model: meta.model,
        systemPrompt: body,
    };
}
export function loadPersona(slug) {
    const locations = [
        // Project-level persona overrides
        path.join(process.cwd(), ".workermill", "personas", `${slug}.md`),
        // User-level persona overrides
        path.join(os.homedir(), ".workermill", "personas", `${slug}.md`),
        // Bundled with the npm package (cli/personas/)
        path.join(import.meta.dirname || __dirname, "../personas", `${slug}.md`),
        // Dev mode — resolve from monorepo
        path.join(import.meta.dirname || __dirname, "../../packages/engine/src/personas", `${slug}.md`),
        path.join(process.cwd(), "packages/engine/src/personas", `${slug}.md`),
    ];
    for (const loc of locations) {
        try {
            if (fs.existsSync(loc)) {
                const content = fs.readFileSync(loc, "utf-8");
                const persona = parsePersonaFile(content);
                if (persona)
                    return persona;
            }
        }
        catch {
            continue;
        }
    }
    // Fallback — generate a default persona
    return {
        name: slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        slug,
        description: `${slug} specialist`,
        tools: ["bash", "read_file", "write_file", "edit_file", "patch", "glob", "grep", "ls", "fetch", "sub_agent"],
        systemPrompt: `You are a senior ${slug.replace(/_/g, " ")}. You write clean, production-ready code following best practices. Focus on your area of expertise and coordinate with other experts when needed.`,
    };
}
export function listAvailablePersonas() {
    const slugs = new Set();
    // Check built-in personas
    const builtinDir = path.join(import.meta.dirname || process.cwd(), "../../packages/engine/src/personas");
    try {
        if (fs.existsSync(builtinDir)) {
            for (const file of fs.readdirSync(builtinDir)) {
                if (file.endsWith(".md")) {
                    slugs.add(file.replace(".md", "").replace(/-/g, "_"));
                }
            }
        }
    }
    catch { /* ignore */ }
    // Check user personas
    const userDir = path.join(os.homedir(), ".workermill", "personas");
    try {
        if (fs.existsSync(userDir)) {
            for (const file of fs.readdirSync(userDir)) {
                if (file.endsWith(".md")) {
                    slugs.add(file.replace(".md", "").replace(/-/g, "_"));
                }
            }
        }
    }
    catch { /* ignore */ }
    // Check project personas
    const projectDir = path.join(process.cwd(), ".workermill", "personas");
    try {
        if (fs.existsSync(projectDir)) {
            for (const file of fs.readdirSync(projectDir)) {
                if (file.endsWith(".md")) {
                    slugs.add(file.replace(".md", "").replace(/-/g, "_"));
                }
            }
        }
    }
    catch { /* ignore */ }
    return Array.from(slugs).sort();
}
