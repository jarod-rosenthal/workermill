import fs from "fs";
import path from "path";
import os from "os";
import * as logger from "./logger.js";

export interface CustomCommand {
  name: string;
  description: string;
  prompt: string;
}

export function loadCustomCommands(): CustomCommand[] {
  const commands: CustomCommand[] = [];
  const dirs = [
    path.join(process.cwd(), ".workermill", "commands"),
    path.join(os.homedir(), ".workermill", "commands"),
  ];

  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith(".md"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), "utf-8");
          const cmd = parseCommandFile(content, file);
          if (cmd && !commands.find(c => c.name === cmd.name)) {
            commands.push(cmd);
          }
        } catch (err) {
          logger.debug("Failed to read custom command file", { file, dir, error: err instanceof Error ? err.message : String(err) });
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

function parseCommandFile(content: string, filename: string): CustomCommand | null {
  // Parse YAML frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    // No frontmatter — use filename as name, entire content as prompt
    const name = filename.replace(/\.md$/, "");
    return { name, description: name, prompt: content.trim() };
  }

  const frontmatter = fmMatch[1];
  const body = fmMatch[2].trim();

  let name = filename.replace(/\.md$/, "");
  let description = name;

  for (const line of frontmatter.split("\n")) {
    const [key, ...valueParts] = line.split(":");
    const value = valueParts.join(":").trim();
    if (key.trim() === "name") name = value;
    if (key.trim() === "description") description = value;
  }

  return { name, description, prompt: body };
}
