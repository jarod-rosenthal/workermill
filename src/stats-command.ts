import path from "path";
import os from "os";
import fs from "fs";
import { getStateRoot } from "./state-root.js";
import chalk from "chalk";
import type { SessionCostByRole } from "./session.js";
import { Session } from "./session.js";
import { formatUsageLedgerLimitation } from "./cost-tracker.js";


/**
 * Stats aggregation types for cross-session analytics.
 */

export interface StatsByModel {
  key: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  roles: string[];
}

export interface StatsByRole {
  worker: { inputTokens: number; outputTokens: number; costUsd: number };
  planner: { inputTokens: number; outputTokens: number; costUsd: number };
  reviewer: { inputTokens: number; outputTokens: number; costUsd: number };
}

export interface StatsByProject {
  cwd: string;
  sessions: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface StatsSummary {
  period: {
    days: number;
    from: string;
    to: string;
  };
  sessions: {
    total: number;
    withCostData: number;
  };
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  costUsd: number;
  avgCostPerSessionUsd: number;
  byModel: StatsByModel[];
  byRole: StatsByRole;
  byProject: StatsByProject[];
  /** Costs are observed estimates; call-level evidence may qualify the subtotal. */
  estimateLimitations: string[];
}

function formatNumber(num: number, decimals: number = 2): string {
  return num.toFixed(decimals);
}

function formatCurrency(usd: number): string {
  if (usd < 0.01) {
    return "~$0.00";
  }
  return `~$${formatNumber(usd, 2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

function formatTokensDetailed(input: number, output: number): string {
  const total = input + output;
  if (total > 0) {
    return `${formatTokens(total)} (${formatTokens(input)} in / ${formatTokens(output)} out)`;
  }
  return formatTokens(total);
}

function calculatePercent(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

/**
 * Get the date threshold for filtering sessions by age.
 */
function getDateThreshold(days: number | null): Date | null {
  if (days === null) {
    return null; // No threshold — include all sessions
  }
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - days);
  return threshold;
}

/**
 * Check if a session is within the specified time threshold.
 */
function isSessionWithinThreshold(session: Session, threshold: Date | null): boolean {
  if (threshold === null) {
    return true; // No threshold — include all sessions
  }
  const startedAt = new Date(session.startedAt);
  return startedAt >= threshold;
}

/**
 * Get the display name for a project path.
 */
function getProjectDisplayName(cwd?: string): string {
  if (!cwd) {
    return "<unknown>";
  }
  // Check if path contains common project indicators
  const relativePath = path.relative(os.homedir(), cwd);
  if (relativePath.startsWith("..")) {
    // Outside home directory, use basename
    return path.basename(cwd);
  }
  // Return a shortened path
  return relativePath;
}

/**
 * Calculate input and output tokens from a session.
 * Sessions with costByModel have accurate split, others use totalTokens.
 */
function getSessionTokenBreakdown(session: Session): { inputTokens: number; outputTokens: number } {
  const modelTokens = session.costByModel?.reduce((total, model) => total + model.inputTokens + model.outputTokens, 0) ?? 0;
  if (session.usageLedgerHistoryIncomplete || (session.usageLedger && modelTokens < (session.totalTokens || 0))) {
    return { inputTokens: session.totalTokens || 0, outputTokens: 0 };
  }
  if (session.costByModel && session.costByModel.length > 0) {
    // Use the accurate breakdown from costByModel
    let inputTokens = 0;
    let outputTokens = 0;
    for (const model of session.costByModel) {
      inputTokens += model.inputTokens;
      outputTokens += model.outputTokens;
    }
    return { inputTokens, outputTokens };
  }
  // Fallback: totalTokens is the sum, we can't split it retroactively
  // Report as all input for backward compatibility
  return { inputTokens: session.totalTokens || 0, outputTokens: 0 };
}

/**
 * Aggregate session data into stats.
 */
function aggregateSessions(sessions: Session[]): StatsSummary {
  const now = new Date();
  const byModel = new Map<string, StatsByModel>();
  const byRole: StatsByRole = {
    worker: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    planner: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    reviewer: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
  const byProject = new Map<string, { sessions: number; costUsd: number; inputTokens: number; outputTokens: number }>();

  let totalSessions = sessions.length;
  let sessionsWithCostData = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  const estimateLimitations = new Set<string>();

  for (const session of sessions) {
    const limitation = formatUsageLedgerLimitation(session.usageLedger);
    if (limitation) estimateLimitations.add(limitation);
    if (session.usageLedgerHistoryIncomplete) estimateLimitations.add("Some historical session totals have no call-level model or role breakdown.");
    // Count tokens properly using the breakdown function
    const tokenBreakdown = getSessionTokenBreakdown(session);
    totalInputTokens += tokenBreakdown.inputTokens;
    totalOutputTokens += tokenBreakdown.outputTokens;

    if (session.totalCostUsd !== undefined) {
      sessionsWithCostData++;
      totalCostUsd += session.totalCostUsd;

      // Aggregate by model
      if (session.costByModel) {
        for (const model of session.costByModel) {
          const key = model.key;
          const existing = byModel.get(key);
          if (!existing) {
            byModel.set(key, {
              key: model.key,
              provider: model.provider,
              model: model.model,
              inputTokens: model.inputTokens,
              outputTokens: model.outputTokens,
              costUsd: model.costUsd,
              roles: [...model.roles],
            });
          } else {
            existing.inputTokens += model.inputTokens;
            existing.outputTokens += model.outputTokens;
            existing.costUsd += model.costUsd;
            for (const role of model.roles) {
              if (!existing.roles.includes(role)) {
                existing.roles.push(role);
              }
            }
          }
        }
      }

      // Aggregate by role
      if (session.costByRole) {
        const roleData = session.costByRole as SessionCostByRole;
        byRole.worker.inputTokens += roleData.worker.inputTokens;
        byRole.worker.outputTokens += roleData.worker.outputTokens;
        byRole.worker.costUsd += roleData.worker.costUsd;

        byRole.planner.inputTokens += roleData.planner.inputTokens;
        byRole.planner.outputTokens += roleData.planner.outputTokens;
        byRole.planner.costUsd += roleData.planner.costUsd;

        byRole.reviewer.inputTokens += roleData.reviewer.inputTokens;
        byRole.reviewer.outputTokens += roleData.reviewer.outputTokens;
        byRole.reviewer.costUsd += roleData.reviewer.costUsd;
      }
    }

    // Aggregate by project
    const cwd = session.cwd || process.cwd();
    const projectKey = cwd;
    const existingProject = byProject.get(projectKey);
    if (!existingProject) {
      byProject.set(projectKey, {
        sessions: 1,
        costUsd: session.totalCostUsd ?? 0,
        inputTokens: tokenBreakdown.inputTokens,
        outputTokens: tokenBreakdown.outputTokens,
      });
    } else {
      existingProject.sessions += 1;
      existingProject.costUsd += session.totalCostUsd ?? 0;
      existingProject.inputTokens += tokenBreakdown.inputTokens;
      existingProject.outputTokens += tokenBreakdown.outputTokens;
    }
  }

  const totalTokens = totalInputTokens + totalOutputTokens;

  const avgCostPerSession = sessionsWithCostData > 0
    ? totalCostUsd / sessionsWithCostData
    : 0;

  // Convert byModel to sorted array
  const byModelArray = Array.from(byModel.values()).sort((a, b) => b.costUsd - a.costUsd);

  // Convert byProject to sorted array
  const byProjectArray = Array.from(byProject.entries())
    .map(([cwd, data]) => ({
      cwd,
      sessions: data.sessions,
      costUsd: data.costUsd,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  // Calculate period dates
  const sessionsStartedAt = sessions.map(s => new Date(s.startedAt));
  const earliestTs = sessionsStartedAt.length > 0 ? Math.min(...sessionsStartedAt.map(d => d.getTime())) : now.getTime();
  const latestTs = sessionsStartedAt.length > 0 ? Math.max(...sessionsStartedAt.map(d => d.getTime())) : now.getTime();
  const earliest = new Date(earliestTs);
  const latest = new Date(latestTs);

  return {
    period: {
      days: Math.round((now.getTime() - earliestTs) / (1000 * 60 * 60 * 24)) + 1,
      from: earliest.toISOString().slice(0, 10),
      to: latest.toISOString().slice(0, 10),
    },
    sessions: {
      total: totalSessions,
      withCostData: sessionsWithCostData,
    },
    tokens: {
      input: totalInputTokens,
      output: totalOutputTokens,
      total: totalTokens,
    },
    costUsd: totalCostUsd,
    avgCostPerSessionUsd: avgCostPerSession,
    byModel: byModelArray,
    byRole: byRole,
    byProject: byProjectArray,
    estimateLimitations: [...estimateLimitations],
  };
}

/**
 * Collect sessions from all project directories.
 */
/**
 * Resolve a path for comparison, following symlinks.
 *
 * `process.cwd()` returns a fully resolved path, but stored session and project
 * paths are whatever the CLI was handed. On macOS `/var` is a symlink to
 * `/private/var`, so raw string equality would never match a session recorded
 * under a symlinked path.
 */
function canonicalize(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    // Path no longer exists — compare the stored value as-is.
    return dir;
  }
}

/** Whether two directory paths refer to the same directory. */
function isSameDirectory(a: string | undefined, b: string): boolean {
  if (!a) return false;
  return a === b || canonicalize(a) === canonicalize(b);
}

function collectAllSessions(threshold: Date | null, cwdFilter?: string): Session[] {
  const projectsDir = path.join(getStateRoot(), "projects");
  const allSessions: Session[] = [];

  if (!fs.existsSync(projectsDir)) {
    return allSessions;
  }

  try {
    const projectDirs = fs.readdirSync(projectsDir).filter(dir =>
      fs.statSync(path.join(projectsDir, dir)).isDirectory()
    );

    for (const projectId of projectDirs) {
      const projectSessionsDir = path.join(projectsDir, projectId, "sessions");
      if (!fs.existsSync(projectSessionsDir)) {
        continue;
      }

      const metaPath = path.join(projectsDir, projectId, "meta.json");
      let projectCwd = "";
      try {
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
          projectCwd = meta.canonicalPath || "";
        }
      } catch {}

      const files = fs.readdirSync(projectSessionsDir).filter(f => f.endsWith(".json"));
      for (const file of files) {
        try {
          const session = JSON.parse(fs.readFileSync(path.join(projectSessionsDir, file), "utf-8")) as Session;
          if (!isSessionWithinThreshold(session, threshold)) {
            continue;
          }
          // Update cwd from project meta if session doesn't have it
          if (!session.cwd && projectCwd) {
            session.cwd = projectCwd;
          }
          // --cwd filters per session, not per project: one directory can hold
          // sessions from more than one working directory.
          if (cwdFilter && !isSameDirectory(session.cwd, cwdFilter)) {
            continue;
          }
          allSessions.push(session);
        } catch (err) {
          // Skip invalid session files
        }
      }
    }
  } catch (err) {
    // Return what we have
  }

  return allSessions;
}

/**
 * Render human-readable stats output.
 */
function renderStats(stats: StatsSummary, days: number | null): string {
  const lines: string[] = [];
  const brand = chalk.hex("#D77757");
  const dim = chalk.dim;
  const bold = chalk.bold;

  // Header
  const periodDesc = days === null ? "all time" : `last ${days} days`;
  lines.push(`  ${brand("◆")} ${bold("WorkerMill Usage — " + periodDesc)}`);
  lines.push("");

  // Summary
  lines.push("  Sessions          " + stats.sessions.total);
  if (stats.sessions.withCostData < stats.sessions.total) {
    lines.push(dim("    (Note: " + (stats.sessions.total - stats.sessions.withCostData) + " session(s) have no cost data)"));
  }
  lines.push("  Estimated cost   " + formatCurrency(stats.costUsd));
  lines.push("  Total tokens     " + formatTokensDetailed(stats.tokens.input, stats.tokens.output));
  if (stats.sessions.withCostData > 0) {
    lines.push("  Avg per session  " + formatCurrency(stats.avgCostPerSessionUsd));
  }
  for (const limitation of stats.estimateLimitations) lines.push(dim("    " + limitation));
  lines.push("");

  // By model
  if (stats.byModel.length > 0) {
    lines.push("  By model");
    const totalModelCost = stats.byModel.reduce((sum, m) => sum + m.costUsd, 0);
    for (const model of stats.byModel) {
      const percent = calculatePercent(model.costUsd, totalModelCost);
      const tokens = model.inputTokens + model.outputTokens;
      const rolesStr = model.roles.join(", ");
      lines.push(
        `    ${model.model.padEnd(28)} ${formatCurrency(model.costUsd).padEnd(10)} ` +
        `${percent.toString().padEnd(4)}% ${formatTokens(tokens)}`
      );
      if (rolesStr) {
        lines.push(dim(`       (${rolesStr})`));
      }
    }
    lines.push("");
  }

  // By role
  const roleTotal = stats.byRole.worker.costUsd + stats.byRole.planner.costUsd + stats.byRole.reviewer.costUsd;
  if (roleTotal > 0) {
    lines.push("  By role");
    const roles: Array<{ name: string; data: { costUsd: number; inputTokens: number; outputTokens: number } }> = [
      { name: "Worker", data: stats.byRole.worker },
      { name: "Planner", data: stats.byRole.planner },
      { name: "Reviewer", data: stats.byRole.reviewer },
    ];
    for (const role of roles) {
      if (role.data.costUsd > 0) {
        const percent = calculatePercent(role.data.costUsd, roleTotal);
        lines.push(
          `    ${role.name.padEnd(16)} ${formatCurrency(role.data.costUsd).padEnd(10)} ` +
          `${percent.toString().padEnd(4)}%`
        );
      }
    }
    lines.push("");
  }

  // By project
  if (stats.byProject.length > 0) {
    lines.push("  Most active projects");
    for (const project of stats.byProject.slice(0, 5)) {
      const displayName = getProjectDisplayName(project.cwd);
      lines.push(
        `    ${displayName.padEnd(32)} ${project.sessions.toString().padEnd(3)} sessions   ` +
        `${formatCurrency(project.costUsd)}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Main stats command handler.
 */
export function runStatsCommand(options: {
  days?: string;
  all?: boolean;
  cwd?: boolean;
  json?: boolean;
}): void {
  const days = options.all
    ? null
    : (options.days !== undefined ? parseInt(options.days, 10) : 30);

  const cwdFilter = options.cwd ? process.cwd() : undefined;

  const threshold = getDateThreshold(days);
  const sessions = collectAllSessions(threshold, cwdFilter);
  const stats = aggregateSessions(sessions);

  if (options.json) {
    // Output JSON with proper precision (6 decimal places for cost values)
    // Convert to snake_case schema
    const jsonStats: Record<string, unknown> = {
      period: stats.period,
      sessions: {
        total: stats.sessions.total,
        with_cost_data: stats.sessions.withCostData,
      },
      tokens: {
        input_tokens: stats.tokens.input,
        output_tokens: stats.tokens.output,
        total_tokens: stats.tokens.total,
      },
      cost_usd: Number(stats.costUsd.toFixed(6)),
      avg_cost_per_session_usd: Number(stats.avgCostPerSessionUsd.toFixed(6)),
      by_model: stats.byModel.map(m => ({
        key: m.key,
        provider: m.provider,
        model: m.model,
        input_tokens: m.inputTokens,
        output_tokens: m.outputTokens,
        cost_usd: Number(m.costUsd.toFixed(6)),
        roles: m.roles,
      })),
      by_role: {
        worker: {
          input_tokens: stats.byRole.worker.inputTokens,
          output_tokens: stats.byRole.worker.outputTokens,
          cost_usd: Number(stats.byRole.worker.costUsd.toFixed(6)),
        },
        planner: {
          input_tokens: stats.byRole.planner.inputTokens,
          output_tokens: stats.byRole.planner.outputTokens,
          cost_usd: Number(stats.byRole.planner.costUsd.toFixed(6)),
        },
        reviewer: {
          input_tokens: stats.byRole.reviewer.inputTokens,
          output_tokens: stats.byRole.reviewer.outputTokens,
          cost_usd: Number(stats.byRole.reviewer.costUsd.toFixed(6)),
        },
      },
      by_project: stats.byProject.map(p => ({
        cwd: p.cwd,
        sessions: p.sessions,
        cost_usd: Number(p.costUsd.toFixed(6)),
        input_tokens: p.inputTokens,
        output_tokens: p.outputTokens,
      })),
    };
    console.log(JSON.stringify(jsonStats, null, 2));
  } else {
    // Output human-readable
    console.log(renderStats(stats, days));
  }
}
