/**
 * Project-management command handlers — extracted from slash-commands.ts
 *
 * Handles: /init, /remember, /forget, /memories, /personas, /skills, /mcp, /projects
 */

import fs from "fs";
import path from "path";
import { getStateRoot } from "../../state-root.js";
import { loadCustomCommands } from "../../custom-commands.js";
import { loadPersona, listAvailablePersonas } from "../../personas.js";
import { hasMCPServers, getMCPTools, hasMCPRegistered, getMCPServerInfo } from "../../mcp-client.js";
import { loadMemories, addMemory, removeMemory, PRIMARY_MEMORY_FILES } from "../../memory.js";
import { getProjectRootDir, listProjects } from "../../project-data.js";
import { resolveConfig } from "../../config.js";
import { runLifecycleHooks } from "../../hooks.js";
import { listMemoriesWithProvenance } from "../../engine/tools/memory.js";
import type { SlashCommandContext } from "../slash-commands.js";
import { BUILTIN_COMMANDS } from "../slash-commands.js";

export function handleInitCommand(arg: string, ctx: SlashCommandContext): void {
  ctx.addSystemMessage("**Tip:** Add `.workermill/*.local.json` to your `.gitignore` to keep personal permission overrides out of version control.");

  const agentPath = path.join(ctx.workingDir, "AGENT.md");
  const exists = fs.existsSync(agentPath);
  const isForce = arg?.includes("--force");

  if (exists && !isForce) {
    ctx.addSystemMessage("**Validating AGENT.md...** Checking accuracy against current codebase.");
    ctx.submit(
      `Read the existing AGENT.md file and validate it against the current state of the codebase.

IMPORTANT: Your default stance is that the file is correct. Do NOT make changes unless something is **concretely wrong or missing**. Rewording for style, reordering sections, or adding "nice to have" content are NOT valid reasons to edit. If the file is accurate and complete, say "AGENT.md is up to date — no changes needed." and stop.

Use your tools to spot-check — read a few key files, verify commands still work, confirm directory structure matches. You do not need to exhaustively re-explore the entire codebase.

Only flag issues that are **factually incorrect**:
- A file path, command, or pattern that no longer exists
- A new top-level module or major dependency that is completely absent
- A command that would fail if an agent ran it

Do NOT touch:
- Wording, tone, or section ordering
- Content that is accurate but could be "more detailed"
- Sections the user wrote manually (custom notes, pitfalls, workflow preferences)

If you find concrete issues, list them and ask the user whether to apply fixes — do NOT write changes automatically. Present a short summary like:

**Found 2 issues:**
1. \`npm run typecheck\` should be \`npx tsc -b\` (command changed)
2. Missing \`api/src/middleware/\` section (new module added since last init)

**Apply fixes?** (say yes or I'll leave it as-is)`,
      "/init (validating AGENT.md)"
    );
  } else {
    ctx.addSystemMessage("**Analyzing codebase...** I'll explore your project and generate `AGENT.md`.");
    ctx.submit(
      `Explore this codebase thoroughly and create an AGENT.md file in the project root. This file will be read by ALL AI agents working on this project — it's the single source of truth for how to work in this codebase.

Use your tools aggressively — list directories, read package.json/requirements.txt/Cargo.toml/go.mod/pyproject.toml, read key source files, check test structure, look at CI configs, read existing docs. Understand the project before writing.

Write an AGENT.md with these sections:

## 1. Project Overview
- What this project does in 1-2 sentences
- Who it's for and what problem it solves

## 2. Tech Stack
- Languages and versions (be specific: "TypeScript 5.x with strict mode", not just "TypeScript")
- Frameworks (Express 4.x, React 19, Next.js 15, etc.)
- Database, ORM, cache, message queue
- Key libraries that shape how code is written

## 3. Architecture
- Directory structure with purpose of each top-level directory
- Architectural pattern (monolith, microservices, monorepo, MVC, clean architecture)
- Data flow — how a request moves through the system
- Key abstractions and patterns used throughout

## 4. Quick Reference
Build a command table:
| Task | Command |
|------|---------|
| Install | \`npm install\` |
| Dev server | \`npm run dev\` |
| Test | \`npm test\` |
| Build | \`npm run build\` |
| Lint | \`npm run lint\` |
| Type check | \`npx tsc --noEmit\` |

Include ALL available scripts, not just the obvious ones.

## 5. Coding Standards
Observe the actual code and document what you see:
- Naming conventions (camelCase, snake_case, file naming)
- File structure patterns (one component per file, barrel exports, etc.)
- Import ordering conventions
- Error handling patterns
- How state is managed
- Comment style and when comments are used

## 6. Key Files & Entry Points
List the most important files an agent should know about:
- Main entry point(s)
- Route definitions
- Database schema/models
- Config files
- Environment variables (.env structure)

## 7. Testing
- Test framework and runner
- Where tests live (co-located, separate directory)
- How to run a single test
- Test patterns used (unit, integration, e2e)
- Any test fixtures or helpers

## 8. Common Pitfalls
Things that would trip up an AI agent:
- Gotchas specific to this codebase
- Environment requirements (specific Node version, Docker needed, etc.)
- Files that should NOT be modified
- Patterns that look wrong but are intentional

## 9. Git & Workflow
- Branch naming conventions
- Commit message format
- PR process if any

Rules for writing:
- Be SPECIFIC — reference actual file paths, actual commands, actual patterns
- Be CONCISE — target under 200 lines, no filler
- Every line should help an AI agent work better in this codebase
- If you can't determine something from the code, leave it out rather than guessing
- Use code blocks for commands and file paths

Write the file with write_file to AGENT.md in the project root.`,
      "/init (generating AGENT.md)"
    );
  }
}

export function handleRememberCommand(arg: string, ctx: SlashCommandContext): void {
  if (!arg) {
    ctx.addSystemMessage("**Usage:** `/remember <text>` \u2014 save a memory for this project\n\nExamples:\n- `/remember This project uses Prisma, not Sequelize`\n- `/remember Always run migrations before tests`");
  } else {
    const mem = addMemory("preference", arg, ctx.workingDir, undefined, undefined, {
      source: "manual",
      confidence: "high",
    });
    try {
      runLifecycleHooks("memory_saved", resolveConfig()?.hooks, ctx.workingDir, {
        WORKERMILL_MEMORY_TYPE: mem.type,
        WORKERMILL_MEMORY_CONTENT: mem.content.substring(0, 10000),
        WORKERMILL_MEMORY_SOURCE: "manual",
      });
    } catch { /* hooks are best-effort */ }
    ctx.addSystemMessage(`**Remembered:** ${mem.content}`);
  }
}

export function handleForgetCommand(arg: string, ctx: SlashCommandContext): void {
  if (!arg) {
    ctx.addSystemMessage("**Usage:** `/forget <text>` \u2014 remove a memory matching the text");
  } else {
    let removed = removeMemory(arg, ctx.workingDir);
    const needle = arg.toLowerCase();

    for (const memory of listMemoriesWithProvenance(ctx.workingDir).filter((entry) => !PRIMARY_MEMORY_FILES.includes(entry.file))) {
      const matches =
        memory.file === arg ||
        memory.file.toLowerCase().includes(needle) ||
        memory.preview.toLowerCase().includes(needle);
      if (!matches) continue;

      try {
        fs.rmSync(path.join(getProjectRootDir(ctx.workingDir), "memories", memory.file), { force: true });
        removed = true;
      } catch {
        // Best effort — keep slash command UX simple.
      }
    }

    ctx.addSystemMessage(removed ? `**Forgot:** memory matching "${arg}"` : `No memory found matching "${arg}". Use \`/memories\` to list all.`);
  }
}

export function handleMemoriesCommand(arg: string, ctx: SlashCommandContext): void {
  const showAll = arg.trim().toLowerCase() === "all";
  const savedMemories = loadMemories(ctx.workingDir);
  const fileMemories = listMemoriesWithProvenance(ctx.workingDir)
    .filter((memory) => !PRIMARY_MEMORY_FILES.includes(memory.file));

  if (savedMemories.length === 0 && fileMemories.length === 0) {
    ctx.addSystemMessage("No memories saved for this project.\n\nMemories are saved automatically when the agent discovers something, or manually with `/remember <text>`.");
    return;
  }

  const lines: string[] = ["**Project Memories**\n"];
  const typeLabels: Record<string, string> = { learning: "Learning", preference: "Preference", context: "Context", correction: "Correction" };
  const formatProvenance = (memory: {
    source?: string;
    confidence?: string;
    persona?: string;
    runId?: string;
    storyId?: string;
  }): string => {
    const tags: string[] = [];
    if (memory.source) tags.push(memory.source);
    if (memory.confidence) tags.push(memory.confidence);
    let suffix = tags.length > 0 ? ` [${tags.join("/")}]` : "";
    if (memory.persona) suffix += ` by ${memory.persona}`;
    if (memory.runId) suffix += ` · run ${memory.runId}`;
    if (memory.storyId) suffix += ` · story ${memory.storyId}`;
    return suffix;
  };

  if (savedMemories.length > 0) {
    lines.push("**Saved Memories**:\n");
    for (const memory of savedMemories) {
      lines.push(`- **[${typeLabels[memory.type] || memory.type}]** ${memory.content} \`(${memory.id})\`${formatProvenance(memory)}`);
    }
    if (fileMemories.length > 0 && !showAll) {
      lines.push("");
      lines.push(`Use \`/memories all\` to see ${fileMemories.length} additional memory file${fileMemories.length === 1 ? "" : "s"}.`);
    }
    lines.push("");
  }

  if (showAll && fileMemories.length > 0) {
    lines.push("**Additional Memory Files** (`~/.workermill/projects/.../memories/`):\n");
    for (const memory of fileMemories) {
      lines.push(`- \`${memory.file}\`${formatProvenance(memory)}`);
      if (memory.preview) lines.push(`  ${memory.preview}`);
    }
  }

  const total = savedMemories.length + fileMemories.length;
  lines.push(`\n${total} total. Use \`/forget <id or text>\` to remove saved memories.`);
  ctx.addSystemMessage(lines.join("\n"));
}

export function handlePersonasCommand(arg: string, ctx: SlashCommandContext): void {
  const allPersonas = listAvailablePersonas();

  if (!arg) {
    const lines: string[] = ["**Personas**\n"];
    const projectDir = path.join(ctx.workingDir, ".workermill", "personas");
    const userDir = path.join(getStateRoot(), "personas");

    for (const slug of allPersonas) {
      const p = loadPersona(slug);
      if (!p) continue;
      let source = "built-in";
      if (fs.existsSync(path.join(projectDir, `${slug.replace(/_/g, "-")}.md`)) ||
          fs.existsSync(path.join(projectDir, `${slug}.md`))) {
        source = "project";
      } else if (fs.existsSync(path.join(userDir, `${slug.replace(/_/g, "-")}.md`)) ||
                 fs.existsSync(path.join(userDir, `${slug}.md`))) {
        source = "user";
      }
      lines.push(`- **${p.name}** (\`${slug}\`) \u2014 ${p.description} [${source}]`);
    }

    lines.push("\n**Customize:**");
    lines.push("- `/personas show <name>` \u2014 view a persona's prompt");
    lines.push("- `/personas create <name>` \u2014 scaffold a custom persona");
    lines.push("- Override built-ins by placing a file in `.workermill/personas/` or `~/.workermill/personas/`");

    ctx.addSystemMessage(lines.join("\n"));
  } else if (arg.startsWith("show ")) {
    const slug = arg.slice(5).trim().replace(/-/g, "_");
    const p = loadPersona(slug);
    if (!p) {
      ctx.addSystemMessage(`Persona \`${slug}\` not found. Use \`/personas\` to list all.`);
    } else {
      ctx.addSystemMessage(
        `**${p.name}** (\`${p.slug}\`)\n\n` +
        `**Description:** ${p.description}\n` +
        `**Tools:** ${p.tools.join(", ")}\n\n` +
        `**System Prompt:**\n\`\`\`\n${p.systemPrompt}\n\`\`\``
      );
    }
  } else if (arg.startsWith("create ")) {
    const slug = arg.slice(7).trim().replace(/\s+/g, "_").toLowerCase();
    const personaDir = path.join(ctx.workingDir, ".workermill", "personas");
    const personaPath = path.join(personaDir, `${slug}.md`);

    fs.mkdirSync(personaDir, { recursive: true });
    const template = `---\nname: ${slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}\nslug: ${slug}\ndescription: Custom ${slug.replace(/_/g, " ")} persona\ntools: [bash, bash_background, bash_output, bash_kill, read_file, write_file, edit_file, multi_edit_file, patch, glob, grep, ls, fetch, sub_agent]\n---\n\nYou are a senior ${slug.replace(/_/g, " ")}. Write clean, production-ready code.\n\n<!-- Customize this prompt for your project -->\n`;
    let fd: number | null = null;
    try {
      fd = fs.openSync(personaPath, "wx", 0o600);
      fs.writeFileSync(fd, template, "utf-8");
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "EEXIST") {
        ctx.addSystemMessage(`Persona \`${slug}\` already exists at \`${personaPath}\`. Edit it directly.`);
        return;
      }
      throw err;
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
    ctx.addSystemMessage(
      `**Created** \`.workermill/personas/${slug}.md\`\n\n` +
      "Edit the file to customize the system prompt, tools, and description. " +
      "This persona will override the built-in one with the same name, or be available as a new persona for the planner to assign."
    );
  } else {
    ctx.addSystemMessage("Usage: `/personas`, `/personas show <name>`, `/personas create <name>`");
  }
}

export function handleSkillsCommand(_arg: string, ctx: SlashCommandContext): void {
  const customCmds = loadCustomCommands();
  const lines: string[] = ["**Skills & Custom Commands**\n"];

  if (customCmds.length > 0) {
    lines.push("**Custom Commands** (`.workermill/commands/` or `~/.workermill/commands/`):\n");
    lines.push("| Command | Description |");
    lines.push("|---|---|");
    const shadowed: string[] = [];
    for (const c of customCmds) {
      if (BUILTIN_COMMANDS.has(c.name)) {
        lines.push(`| \`/${c.name}\` | ${c.description} \u26a0\ufe0f **shadowed by built-in** |`);
        shadowed.push(c.name);
      } else {
        lines.push(`| \`/${c.name}\` | ${c.description} |`);
      }
    }
    if (shadowed.length > 0) {
      lines.push(`\n\u26a0\ufe0f **${shadowed.length} command(s) shadowed:** \`${shadowed.join("`, `")}\` \u2014 these match built-in commands and will never run. Rename them to avoid the conflict.`);
    }
  } else {
    lines.push("No custom commands found.\n");
    lines.push("Create `.workermill/commands/deploy.md` to add `/deploy`:\n");
    lines.push("```markdown");
    lines.push("---");
    lines.push("name: deploy");
    lines.push("description: Deploy to production");
    lines.push("---");
    lines.push("Run the deploy script and report results.");
    lines.push("```");
  }

  ctx.addSystemMessage(lines.join("\n"));
}

export function handleMcpCommand(_arg: string, ctx: SlashCommandContext): void {
  if (hasMCPServers()) {
    const tools = getMCPTools();
    const serverInfo = getMCPServerInfo();
    const transportByName = new Map(serverInfo.map((s) => [s.name, s.transport]));
    const byServer = new Map<string, string[]>();
    for (const { serverName, tool } of tools) {
      if (!byServer.has(serverName)) byServer.set(serverName, []);
      byServer.get(serverName)!.push(tool.name);
    }
    const lines: string[] = ["**MCP Servers (active)**\n"];
    for (const [name, toolNames] of byServer) {
      const transport = transportByName.get(name) || "stdio";
      lines.push(`- **${name}** (${transport}) \u2014 ${toolNames.length} tools: ${toolNames.join(", ")}`);
    }
    ctx.addSystemMessage(lines.join("\n"));
  } else if (hasMCPRegistered()) {
    ctx.addSystemMessage(
      "**MCP servers detected.** Tools will be available on your first prompt."
    );
  } else {
    ctx.addSystemMessage(
      "**No MCP servers configured.**\n\n" +
      "MCP servers are auto-detected from Docker Desktop, or add them to `~/.workermill/cli.json`:\n\n" +
      "**stdio** (local process):\n" +
      "```json\n\"mcp\": {\n  \"my-server\": {\n    \"command\": \"npx\",\n    \"args\": [\"-y\", \"my-mcp-server\"]\n  }\n}\n```\n\n" +
      "**http** or **sse** (remote server):\n" +
      "```json\n\"mcp\": {\n  \"my-server\": {\n    \"transport\": \"http\",\n    \"url\": \"https://my-mcp-server.example.com/mcp\",\n    \"headers\": { \"Authorization\": \"Bearer <token>\" }\n  }\n}\n```\n\n" +
      "Servers start on your first prompt."
    );
  }
}

export function handleProjectsCommand(_arg: string, ctx: SlashCommandContext): void {
  const projects = listProjects();
  if (projects.length === 0) {
    ctx.addSystemMessage("No known projects found. Projects are tracked when you work in them.");
  } else {
    const rows = projects.map((p) => {
      const date = new Date(p.lastAccessed).toLocaleString();
      const pathShort = p.canonicalPath.length > 50 ? p.canonicalPath.slice(0, 47) + "..." : p.canonicalPath;
      return `| \`${p.id}\` | \`${pathShort}\` | ${date} |`;
    });
    ctx.addSystemMessage(
      `**Known Projects** (${projects.length})\n\n` +
      `| ID | Path | Last Accessed |\n` +
      `|---|---|---|\n` +
      rows.join("\n")
    );
  }
}
