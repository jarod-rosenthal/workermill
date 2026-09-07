import { execFile, type ChildProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export async function stopProcessGroup(
  child: ChildProcess,
  killProcess: typeof process.kill,
  graceMs: number,
  inspect: (groupId: number) => Promise<number[] | null> = liveGroupMembers,
): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try { child.kill("SIGTERM"); } catch { /* native Windows is not qualified */ }
    return;
  }
  const groupPid = -child.pid;
  const failures: Error[] = [];
  const signalGroup = async (signal: NodeJS.Signals): Promise<void> => {
    try {
      killProcess(groupPid, signal);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ESRCH") return;
      if (nodeError.code === "EPERM" && (await inspect(-groupPid))?.length === 0) return;
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  };
  // Do this even after the direct parent has exited: descendants retain the
  // original process group and a TERM-ignoring orphan needs SIGKILL.
  await signalGroup("SIGTERM");
  await waitForGroupGone(groupPid, killProcess, graceMs, inspect);
  await signalGroup("SIGKILL");
  // Some launchers can leave a descendant visible while the group leader has
  // already exited. Preserve group signalling as the primary operation, then
  // make the final kill explicit for every remaining live member.
  for (const memberPid of (await inspect(-groupPid)) ?? []) {
    try {
      killProcess(memberPid, "SIGKILL");
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ESRCH") failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (!await waitForGroupGone(groupPid, killProcess, graceMs, inspect)) {
    throw new Error("Browser process group did not exit within the cleanup grace period");
  }
  if (failures.length > 0) throw new AggregateError(failures, "Failed to signal browser process group");
}

async function waitForGroupGone(
  groupPid: number,
  killProcess: typeof process.kill,
  graceMs: number,
  inspect: (groupId: number) => Promise<number[] | null>,
): Promise<boolean> {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    try {
      killProcess(groupPid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
      // Darwin can report EPERM for zombie-only groups. Absence of live
      // members must be independently established; unknown state is failure.
      if ((error as NodeJS.ErrnoException).code === "EPERM" && (await inspect(-groupPid))?.length === 0) return true;
      throw error;
    }
    if ((await inspect(-groupPid))?.length === 0) return true;
    await delay(25);
  }
  // A final probe makes teardown failure visible rather than pretending a
  // TERM-ignoring descendant was gone because its parent exited.
  try {
    killProcess(groupPid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    if ((error as NodeJS.ErrnoException).code === "EPERM" && (await inspect(-groupPid))?.length === 0) return true;
    throw error;
  }
  if ((await inspect(-groupPid))?.length === 0) return true;
  return false;
}

export async function liveGroupMembers(groupId: number): Promise<number[] | null> {
  if (process.platform === "darwin") {
    return new Promise((resolve) => {
      execFile("/bin/ps", ["-axo", "pid=,pgid=,stat="], { timeout: 500, maxBuffer: 1024 * 1024, encoding: "utf8" }, (error, stdout) => {
        if (error) return resolve(null);
        const members: number[] = [];
        const lines = stdout.trim().split("\n");
        for (const line of lines) {
          const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
          if (!match) return resolve(null);
          if (Number(match[2]) === groupId && !match[3]!.startsWith("Z")) members.push(Number(match[1]));
        }
        resolve(members);
      });
    });
  }
  if (process.platform !== "linux") return null;
  try {
    const entries = await readdir("/proc");
    const members: number[] = [];
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = await readFile(`/proc/${entry}/stat`, "utf8");
        const closing = stat.lastIndexOf(")");
        const fields = stat.slice(closing + 2).split(" ");
        // /proc/<pid>/stat after comm: state, ppid, pgrp, ...
        if (Number(fields[2]) === groupId && fields[0] !== "Z") members.push(Number(entry));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ESRCH") return null;
      }
    }
    return members;
  } catch {
    // Keep the portable conservative behavior when /proc is unavailable.
    return null;
  }
}

