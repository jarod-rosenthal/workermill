import fs from "fs";
import path from "path";
import { getStateRoot } from "./state-root.js";
import * as logger from "./logger.js";

export interface CustomCommand {
  name: string;
  description: string;
  prompt: string;
  /** Tool names this skill restricts to (undefined = all tools) */
  allowedTools?: string[];
  /** Model override when running this skill */
  model?: string;
  /** When the model should auto-invoke this skill */
  whenToUse?: string;
  /** Description of expected arguments */
  args?: string;
  /** Where this was loaded from */
  source: "project-skills" | "user-skills" | "project-commands" | "user-commands";
}

export function loadCustomCommands(): CustomCommand[] {
  const commands: CustomCommand[] = [];
  const dirs: { path: string; source: CustomCommand["source"] }[] = [
    { path: path.join(process.cwd(), ".workermill", "skills"), source: "project-skills" },
    { path: path.join(getStateRoot(), "skills"), source: "user-skills" },
    { path: path.join(process.cwd(), ".workermill", "commands"), source: "project-commands" },
    { path: path.join(getStateRoot(), "commands"), source: "user-commands" },
  ];

  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir.path)) continue;
      const files = fs.readdirSync(dir.path).filter(f => f.endsWith(".md"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir.path, file), "utf-8");
          const cmd = parseCommandFile(content, file, dir.source);
          if (cmd && !commands.find(c => c.name === cmd.name)) {
            commands.push(cmd);
          }
        } catch (err) {
          logger.debug("Failed to read custom command file", { file, dir: dir.path, error: err instanceof Error ? err.message : String(err) });
          continue;
        }
      }
    } catch {
      // Directory doesn't exist or unreadable — skip
      continue;
    }
  }

  return commands;
}

function parseCommandFile(content: string, filename: string, source: CustomCommand["source"]): CustomCommand | null {
  // Parse YAML frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    // No frontmatter — use filename as name, entire content as prompt
    const name = filename.replace(/\.md$/, "");
    return { name, description: name, prompt: content.trim(), source };
  }

  const frontmatter = fmMatch[1];
  const body = fmMatch[2].trim();

  let name = filename.replace(/\.md$/, "");
  let description = name;
  let allowedTools: string[] | undefined;
  let model: string | undefined;
  let whenToUse: string | undefined;
  let args: string | undefined;

  for (const line of frontmatter.split("\n")) {
    const [key, ...valueParts] = line.split(":");
    const value = valueParts.join(":").trim();
    const k = key.trim();
    if (k === "name") name = value;
    else if (k === "description") description = value;
    else if (k === "model") model = value || undefined;
    else if (k === "whenToUse") whenToUse = value || undefined;
    else if (k === "args") args = value || undefined;
    else if (k === "allowedTools") allowedTools = parseArrayValue(value);
  }

  return { name, description, prompt: body, allowedTools, model, whenToUse, args, source };
}

function parseArrayValue(value: string): string[] | undefined {
  // Handle [item1, item2, item3] syntax
  const stripped = value.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!stripped) return undefined;
  const items = stripped.split(",").map(s => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}
