/**
 * Documentation consistency tests — verify docs match the codebase.
 *
 * These catch doc drift automatically instead of requiring manual audits.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

describe("docs consistency", () => {
  describe("personas", () => {
    it("all persona files listed in README match actual files", () => {
      const personasDir = path.join(ROOT, "personas");
      const files = fs.readdirSync(personasDir).filter(f => f.endsWith(".md")).map(f => f.replace(".md", ""));
      const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf-8");

      for (const persona of files) {
        // Each persona slug should appear in the README personas table
        expect(readme).toContain(persona);
      }
    });

    it("persona count in README matches actual files", () => {
      const personasDir = path.join(ROOT, "personas");
      const count = fs.readdirSync(personasDir).filter(f => f.endsWith(".md")).length;
      const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf-8");
      // README says "N Built-in Personas"
      const match = readme.match(/(\d+)\s+Built-in Personas/i);
      expect(match).not.toBeNull();
      expect(parseInt(match![1])).toBe(count);
    });
  });

  describe("tools", () => {
    it("tool count in README matches registered tools", () => {
      const indexTs = fs.readFileSync(path.join(SRC, "engine/tools/index.ts"), "utf-8");
      // Count all tool() registrations at any indent level inside createToolDefinitions
      const toolDefs = indexTs.match(/\w+: tool\(\{/g) || [];
      // Deduplicate (sub_agent appears in both the main set and the read-only worktree set)
      const toolNames = new Set(toolDefs.map(m => m.replace(": tool({", "")));
      const actualCount = toolNames.size;

      const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf-8");
      const match = readme.match(/(\d+)\s+tools/i);
      expect(match).not.toBeNull();
      expect(parseInt(match![1])).toBe(actualCount);
    });

    it("all tool names in README tools table exist in index.ts", () => {
      const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf-8");
      const indexTs = fs.readFileSync(path.join(SRC, "engine/tools/index.ts"), "utf-8");

      // Extract tool names from README table (lines like "| `tool_name` |")
      const tableTools = [...readme.matchAll(/\| `(\w+)` \|/g)].map(m => m[1]);
      // Filter to only tools section (between "tools" header and "MCP" section)
      const toolsSectionMatch = readme.match(/gives its agents \d+ tools[\s\S]*?Plus any tools/);
      if (!toolsSectionMatch) return; // Skip if section not found
      const toolsSection = toolsSectionMatch[0];
      const docToolNames = [...toolsSection.matchAll(/\| `(\w+)`/g)].map(m => m[1]);

      for (const toolName of docToolNames) {
        // Each documented tool should appear as a key in createToolDefinitions
        expect(indexTs).toContain(`${toolName}:`);
      }
    });
  });

  describe("CLI subcommands", () => {
    it("all documented CLI subcommands exist in index.ts", () => {
      const commandsDoc = fs.readFileSync(path.join(ROOT, "docs/commands.md"), "utf-8");
      const indexTs = fs.readFileSync(path.join(SRC, "index.ts"), "utf-8");

      // Extract "### `wm <command>`" headers from commands.md
      const docCommands = [...commandsDoc.matchAll(/### `wm (\w+)/g)].map(m => m[1]);

      for (const cmd of docCommands) {
        // Each documented subcommand should have a .command() registration
        expect(indexTs).toContain(`.command("${cmd}`);
      }
    });
  });

  describe("configuration", () => {
    it("all top-level config fields in docs exist in Zod schema", () => {
      const configDoc = fs.readFileSync(path.join(ROOT, "docs/configuration.md"), "utf-8");
      const configTs = fs.readFileSync(path.join(SRC, "config.ts"), "utf-8");

      // Extract ## `fieldName` headers from configuration.md
      const docFields = [...configDoc.matchAll(/^## `(\w+)`/gm)].map(m => m[1]);

      for (const field of docFields) {
        // Each documented field should appear in the config type or Zod schema
        const inType = configTs.includes(`${field}?:`) || configTs.includes(`${field}:`);
        const inZod = configTs.includes(`${field}:`);
        expect(inType || inZod, `Config field "${field}" documented but not in config.ts`).toBe(true);
      }
    });
  });

  describe("slash commands", () => {
    it("HELP_TEXT commands have corresponding case handlers", () => {
      const slashTs = fs.readFileSync(path.join(SRC, "ui/slash-commands.ts"), "utf-8");

      // Extract command names from HELP_TEXT table (lines like "| `/command` |")
      const helpCommands = [...slashTs.matchAll(/\| `\/(\w+)/g)].map(m => m[1]);

      // Each help-listed command should have a case handler somewhere
      // (could be in slash-commands.ts or delegated to a commands/ module)
      const allCommandCode = [
        slashTs,
        ...["settings", "permissions", "session", "project"].map(f => {
          try { return fs.readFileSync(path.join(SRC, `ui/commands/${f}.ts`), "utf-8"); } catch { return ""; }
        }),
      ].join("\n");

      for (const cmd of helpCommands) {
        const hasCaseHandler = allCommandCode.includes(`case "${cmd}"`) ||
          allCommandCode.includes(`handle${cmd.charAt(0).toUpperCase() + cmd.slice(1)}Command`);
        expect(hasCaseHandler, `Slash command /${cmd} in HELP_TEXT but no case handler found`).toBe(true);
      }
    });
  });
});
