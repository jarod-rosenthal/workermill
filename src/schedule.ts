import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import * as logger from "./logger.js";

const SCHEDULE_FILE = path.join(os.homedir(), ".workermill", "schedules.json");

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
    if (fs.existsSync(SCHEDULE_FILE)) {
      return JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf-8")) as ScheduledTask[];
    }
  } catch (err) {
    logger.error("Failed to load schedules", { error: err instanceof Error ? err.message : String(err) });
  }
  return [];
}

function saveSchedules(schedules: ScheduledTask[]): void {
  const dir = path.dirname(SCHEDULE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedules, null, 2) + "\n", "utf-8");
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
  const workermill = "npx workermill";
  const cmd = `cd "${task.workingDir}" && ${workermill} --trust -p "${task.prompt.replace(/"/g, '\\"')}" >> ~/.workermill/schedule-${task.id}.log 2>&1`;

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

      execSync(
        `schtasks /Create /TN "WorkerMill_${task.id}" ${schedType} /ST ${hour === "*" ? "00" : hour.padStart(2, "0")}:${minute.padStart(2, "0")} /TR "cmd /c ${cmd.replace(/"/g, '\\"')}" /F`,
        { stdio: "pipe" }
      );
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
        existing = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
      } catch { /* no existing crontab */ }

      // Remove any existing entry for this task
      const lines = existing.split("\n").filter(l => !l.includes(`WorkerMill:${task.id}`));
      lines.push(`${task.cron} ${cmd} # WorkerMill:${task.id}`);

      const newCrontab = lines.filter(l => l.trim()).join("\n") + "\n";
      execSync(`echo "${newCrontab.replace(/"/g, '\\"')}" | crontab -`, { stdio: "pipe" });
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
      execSync(`schtasks /Delete /TN "WorkerMill_${taskId}" /F`, { stdio: "pipe" });
    } catch { /* may not exist */ }
  } else {
    try {
      const existing = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
      const lines = existing.split("\n").filter(l => !l.includes(`WorkerMill:${taskId}`));
      const newCrontab = lines.filter(l => l.trim()).join("\n") + "\n";
      execSync(`echo "${newCrontab.replace(/"/g, '\\"')}" | crontab -`, { stdio: "pipe" });
    } catch (err) {
      logger.debug("Failed to remove crontab entry", { taskId, error: err instanceof Error ? err.message : String(err) });
    }
  }
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
