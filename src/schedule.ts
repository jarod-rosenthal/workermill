import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { getStateRoot } from "./state-root.js";
import * as logger from "./logger.js";

const SCHEDULE_FILE = path.join(getStateRoot(), "schedules.json");
const SCHEDULE_DIR = path.join(getStateRoot(), "schedule");

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  cron: string;  // cron expression
  workingDir: string;
  createdAt: string;
}

function loadSchedules(): ScheduledTask[] {
  try {
    return JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf-8")) as ScheduledTask[];
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return [];
    logger.error("Failed to load schedules", { error: err instanceof Error ? err.message : String(err) });
  }
  return [];
}

function saveSchedules(schedules: ScheduledTask[]): void {
  const dir = path.dirname(SCHEDULE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedules, null, 2) + "\n", "utf-8");
}

function safeTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9_-]/g, "_") || "task";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function schedulePaths(taskId: string): { id: string; promptPath: string; scriptPath: string; logPath: string } {
  const id = safeTaskId(taskId);
  return {
    id,
    promptPath: path.join(SCHEDULE_DIR, `${id}.prompt.txt`),
    scriptPath: path.join(SCHEDULE_DIR, process.platform === "win32" ? `${id}.ps1` : `${id}.sh`),
    logPath: path.join(SCHEDULE_DIR, `${id}.log`),
  };
}

function writeScheduleFiles(task: ScheduledTask): ReturnType<typeof schedulePaths> {
  const paths = schedulePaths(task.id);
  fs.mkdirSync(SCHEDULE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(paths.promptPath, task.prompt, { encoding: "utf-8", mode: 0o600 });

  if (process.platform === "win32") {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `Set-Location -LiteralPath ${powerShellQuote(task.workingDir)}`,
      `$promptText = Get-Content -LiteralPath ${powerShellQuote(paths.promptPath)} -Raw`,
      `npx workermill --trust -p $promptText *>> ${powerShellQuote(paths.logPath)}`,
      "",
    ].join("\n");
    fs.writeFileSync(paths.scriptPath, script, { encoding: "utf-8", mode: 0o700 });
  } else {
    const script = [
      "#!/bin/sh",
      "set -eu",
      `cd ${shellQuote(task.workingDir)}`,
      `npx workermill --trust -p "$(cat ${shellQuote(paths.promptPath)})" >> ${shellQuote(paths.logPath)} 2>&1`,
      "",
    ].join("\n");
    fs.writeFileSync(paths.scriptPath, script, { encoding: "utf-8", mode: 0o700 });
    fs.chmodSync(paths.scriptPath, 0o700);
  }

  return paths;
}

function removeScheduleFiles(taskId: string): void {
  const paths = schedulePaths(taskId);
  for (const file of [paths.promptPath, paths.scriptPath, paths.logPath]) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // Best-effort cleanup only; deleting the schedule should not fail on stale files.
    }
  }
}

function cronLineBelongsToTask(line: string, taskId: string): boolean {
  return line.includes(`WorkerMill:${safeTaskId(taskId)}`) || line.includes(`WorkerMill:${taskId}`);
}

/** Parse human-readable schedule into cron expression */
function parseCron(input: string): string | null {
  const lower = input.toLowerCase().trim();

  // Direct cron expression
  if (/^\d|\*/.test(lower) && lower.split(/\s+/).length === 5) return lower;

  // Common patterns
  const patterns: Record<string, string> = {
    "every hour": "0 * * * *",
    "hourly": "0 * * * *",
    "every day at 9am": "0 9 * * *",
    "every day at 9": "0 9 * * *",
    "daily": "0 9 * * *",
    "every morning": "0 9 * * *",
    "every evening": "0 18 * * *",
    "every night": "0 22 * * *",
    "every monday": "0 9 * * 1",
    "every tuesday": "0 9 * * 2",
    "every wednesday": "0 9 * * 3",
    "every thursday": "0 9 * * 4",
    "every friday": "0 9 * * 5",
    "weekly": "0 9 * * 1",
    "every week": "0 9 * * 1",
  };

  for (const [key, cron] of Object.entries(patterns)) {
    if (lower.includes(key)) return cron;
  }

  // "every N minutes/hours"
  const minuteMatch = lower.match(/every\s+(\d+)\s+min/);
  if (minuteMatch) return `*/${minuteMatch[1]} * * * *`;

  const hourMatch = lower.match(/every\s+(\d+)\s+hour/);
  if (hourMatch) return `0 */${hourMatch[1]} * * *`;

  // "at HH:MM" or "at H am/pm"
  const timeMatch = lower.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    if (timeMatch[3] === "pm" && hour < 12) hour += 12;
    if (timeMatch[3] === "am" && hour === 12) hour = 0;
    return `${minute} ${hour} * * *`;
  }

  return null;
}

/** Install a cron job for a scheduled task */
function installCron(task: ScheduledTask): boolean {
  const platform = process.platform;
  const paths = writeScheduleFiles(task);

  if (platform === "win32") {
    // Windows: use schtasks
    try {
      // Convert cron to schtasks format (simplified)
      const parts = task.cron.split(" ");
      const minute = parts[0] === "*" ? "00" : parts[0].replace("*/", "");
      const hour = parts[1] === "*" ? "*" : parts[1].replace("*/", "");

      let schedType = "/SC DAILY";
      if (parts[4] !== "*") schedType = "/SC WEEKLY /D MON"; // simplified
      if (hour === "*") schedType = `/SC MINUTE /MO ${minute}`;

      const schtasksArgs = [
        "/Create",
        "/TN",
        `WorkerMill_${paths.id}`,
        ...schedType.split(" "),
        "/ST",
        `${hour === "*" ? "00" : hour.padStart(2, "0")}:${minute.padStart(2, "0")}`,
        "/TR",
        `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${paths.scriptPath}"`,
        "/F",
      ];
      execFileSync("schtasks", schtasksArgs, { stdio: "pipe" });
      return true;
    } catch (err) {
      logger.error(`Failed to create Windows scheduled task: ${err}`);
      return false;
    }
  } else {
    // Unix: use crontab
    try {
      let existing = "";
      try {
        existing = execFileSync("crontab", ["-l"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      } catch { /* no existing crontab */ }

      // Remove any existing entry for this task
      const lines = existing.split("\n").filter(l => !cronLineBelongsToTask(l, task.id));
      lines.push(`${task.cron} ${shellQuote(paths.scriptPath)} # WorkerMill:${paths.id}`);

      const newCrontab = lines.filter(l => l.trim()).join("\n") + "\n";
      execFileSync("crontab", ["-"], { input: newCrontab, stdio: ["pipe", "pipe", "pipe"] });
      return true;
    } catch (err) {
      logger.error(`Failed to install crontab: ${err}`);
      return false;
    }
  }
}

/** Remove a cron job for a scheduled task */
function removeCron(taskId: string): void {
  if (process.platform === "win32") {
    try {
      execFileSync("schtasks", ["/Delete", "/TN", `WorkerMill_${safeTaskId(taskId)}`, "/F"], { stdio: "pipe" });
    } catch { /* may not exist */ }
  } else {
    try {
      const existing = execFileSync("crontab", ["-l"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      const lines = existing.split("\n").filter(l => !cronLineBelongsToTask(l, taskId));
      const newCrontab = lines.filter(l => l.trim()).join("\n") + "\n";
      execFileSync("crontab", ["-"], { input: newCrontab, stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      logger.debug("Failed to remove crontab entry", { taskId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  removeScheduleFiles(taskId);
}

export function createSchedule(name: string, prompt: string, schedule: string, workingDir: string): { success: boolean; message: string } {
  const cron = parseCron(schedule);
  if (!cron) {
    return { success: false, message: `Could not parse schedule: "${schedule}"\n\nExamples: "every day at 9am", "every hour", "weekly", "every 30 minutes", or a cron expression like "0 9 * * *"` };
  }

  const task: ScheduledTask = {
    id: Date.now().toString(36),
    name,
    prompt,
    cron,
    workingDir,
    createdAt: new Date().toISOString(),
  };

  const schedules = loadSchedules();
  schedules.push(task);
  saveSchedules(schedules);

  const installed = installCron(task);

  return {
    success: true,
    message: `**Scheduled:** "${name}"\n` +
      `**Prompt:** ${prompt}\n` +
      `**Schedule:** ${cron} (${schedule})\n` +
      `**Directory:** ${workingDir}\n` +
      (installed ? "**Status:** Cron job installed" : "**Status:** Saved but cron install failed -- run manually"),
  };
}

export function listSchedules(): ScheduledTask[] {
  return loadSchedules();
}

export function deleteSchedule(nameOrId: string): { success: boolean; message: string } {
  const schedules = loadSchedules();
  const idx = schedules.findIndex(s => s.id === nameOrId || s.name.toLowerCase() === nameOrId.toLowerCase());
  if (idx === -1) return { success: false, message: `Schedule "${nameOrId}" not found.` };

  const task = schedules[idx];
  removeCron(task.id);
  schedules.splice(idx, 1);
  saveSchedules(schedules);

  return { success: true, message: `**Deleted** schedule "${task.name}" and removed cron job.` };
}
