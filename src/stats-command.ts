import fs from "fs";
import path from "path";
import chalk from "chalk";
import { type Session, type SessionCostModel, type SessionRoleCost } from "./session.js";
import { getProjectSessionsDir, listProjects } from "./project-data.js";

/**
 * Stats CLI command handler
 * 
 * Aggregates session data across all projects for usage and cost analytics.
 * Supports filtering by date range, working directory, and output format.
 */

// ── Types ──

export interface StatsOptions {
  days?: number;
  all?: boolean;
  cwd?: boolean;
  json?: boolean;
}

export interface StatsPeriod {
  days: number;
  from: string;
  to: string;
}

export interface StatsSessions {
  total: number;
  withCostData: number;
}

export interface StatsTokens {
  input: number;
  output: number;
  total: number;
}

export interface StatsModel extends SessionCostModel {
  roles: string[];
}

export interface StatsRole {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface StatsRoleBreakdown {
  worker: StatsRole;
  planner: StatsRole;
  reviewer: StatsRole;
}

export interface StatsProject {
  cwd: string;
  sessions: number;
  costUsd: number;
}

export interface StatsOutput {
  period: StatsPeriod;
  sessions: StatsSessions;
  tokens: StatsTokens;
  costUsd: number;
  avgCostPerSessionUsd: number;
  byModel: StatsModel[];
  byRole: StatsRoleBreakdown;
  byProject: StatsProject[];
}

// ── Helpers ──

/**
 * Format a number with locale-aware grouping
 */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Format USD amount
 */
function formatUSD(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

/**
 * Format tokens with K/M suffix
 */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return formatNumber(n);
}

/**
 * Calculate percentage
 */
function calcPercentage(value: number, total: number): number {
  if (total === 0) return 0;
  return (value / total) * 100;
}

/**
 * Get all session files from all project directories
 */
function getAllSessionFiles(): Array<{ filePath: string; cwd: string }> {
  const sessions: Array<{ filePath: string; cwd: string }> = [];
  
  const projectsDir = path.join(path.dirname(getProjectSessionsDir()), "..");
  
  if (!fs.existsSync(projectsDir)) {
    return sessions;
  }
  
  try {
    const projectDirs = fs.readdirSync(projectsDir).filter(dir => {
      const fullPath = path.join(projectsDir, dir);
      return fs.statSync(fullPath).isDirectory() && /^[a-f0-9]{8}$/.test(dir);
    });
    
    for (const projectId of projectDirs) {
      const sessionsDir = path.join(projectsDir, projectId, "sessions");
      const metaPath = path.join(projectsDir, projectId, "meta.json");
      
      let cwd = `unknown-${projectId}`;
      try {
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as { canonicalPath?: string };
          cwd = meta.canonicalPath || `unknown-${projectId}`;
        }
      } catch {
        // Skip if meta file is invalid
      }
      
      if (!fs.existsSync(sessionsDir)) continue;
      
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".json"));
      for (const file of files) {
        sessions.push({
          filePath: path.join(sessionsDir, file),
          cwd,
        });
      }
    }
  } catch (err) {
    // Return what we have if directory operations fail
  }
  
  return sessions;
}

/**
 * Load and parse a session from a file path
 */
function loadSessionFile(filePath: string): Session | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<Session>;
    
    // Add updatedAt if missing for backwards compatibility
    if (!content.updatedAt) {
      content.updatedAt = content.startedAt || new Date().toISOString();
    }
    
    // Validate required fields
    if (!content.id || !content.startedAt) return null;
    
    return content as Session;
  } catch {
    return null;
  }
}

/**
 * Filter sessions by date range and/or working directory
 */
function filterSessions(
  sessions: Array<{ session: Session; cwd: string }>,
  options: StatsOptions
): Array<{ session: Session; cwd: string }> {
  const now = new Date();
  const cutoffDate = options.all 
    ? new Date(0) // Include all time
    : new Date(now.getTime() - ((options.days ?? 30) * 24 * 60 * 60 * 1000));
  
  const filterCwd = options.cwd ? process.cwd() : undefined;
  
  return sessions.filter(({ session, cwd }) => {
    // Filter by date
    const sessionDate = new Date(session.startedAt);
    if (sessionDate < cutoffDate) return false;
    
    // Filter by working directory
    if (filterCwd && cwd !== filterCwd) return false;
    
    return true;
  });
}

/**
 * Aggregate statistics from a list of sessions
 */
function aggregateStats(sessions: Array<{ session: Session; cwd: string }>): StatsOutput {
  const now = new Date().toISOString();
  const options: StatsOptions = {}; // Will be passed in actual use
  
  // Calculate date range
  const days = options.days ?? 30;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  
  const period: StatsPeriod = {
    days: days,
    from: from.toISOString().slice(0, 10),
    to: now.slice(0, 10),
  };
  
  let sessionsWithCostData = 0;
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  
  const modelMap = new Map<string, StatsModel>();
  const roleMap: Map<string, StatsRole> = new Map();
  const projectMap = new Map<string, { sessions: number; costUsd: number }>();
  
  for (const { session, cwd } of sessions) {
    // Initialize role buckets
    ["worker", "planner", "reviewer"].forEach(role => {
      if (!roleMap.has(role)) {
        roleMap.set(role, { costUsd: 0, inputTokens: 0, outputTokens: 0 });
      }
    });
    
    // Initialize project bucket
    if (!projectMap.has(cwd)) {
      projectMap.set(cwd, { sessions: 0, costUsd: 0 });
    }
    const projectEntry = projectMap.get(cwd)!;
    projectEntry.sessions += 1;
    
    // Count tokens (always, even without cost data)
    totalInputTokens += session.totalTokens || 0;
    totalOutputTokens += session.totalTokens || 0;
    
    // Count cost data if available
    if (session.totalCostUsd !== undefined) {
      sessionsWithCostData += 1;
      totalCostUsd += session.totalCostUsd || 0;
      projectEntry.costUsd += session.totalCostUsd || 0;
      
      // Aggregate by model
      if (session.costByModel) {
        for (const model of session.costByModel) {
          const existing = modelMap.get(model.key);
          if (!existing) {
            modelMap.set(model.key, {
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
            // Merge roles without duplicates
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
        const costByRole = session.costByRole;
        if (costByRole.worker) {
          const r = roleMap.get("worker")!;
          r.costUsd += costByRole.worker.costUsd || 0;
          r.inputTokens += costByRole.worker.inputTokens || 0;
          r.outputTokens += costByRole.worker.outputTokens || 0;
        }
        if (costByRole.planner) {
          const r = roleMap.get("planner")!;
          r.costUsd += costByRole.planner.costUsd || 0;
          r.inputTokens += costByRole.planner.inputTokens || 0;
          r.outputTokens += costByRole.planner.outputTokens || 0;
        }
        if (costByRole.reviewer) {
          const r = roleMap.get("reviewer")!;
          r.costUsd += costByRole.reviewer.costUsd || 0;
          r.inputTokens += costByRole.reviewer.inputTokens || 0;
          r.outputTokens += costByRole.reviewer.outputTokens || 0;
        }
      }
    }
  }
  
  const byModel = Array.from(modelMap.values()).sort((a, b) => b.costUsd - a.costUsd);
  const byRole: StatsRoleBreakdown = {
    worker: roleMap.get("worker") || { costUsd: 0, inputTokens: 0, outputTokens: 0 },
    planner: roleMap.get("planner") || { costUsd: 0, inputTokens: 0, outputTokens: 0 },
    reviewer: roleMap.get("reviewer") || { costUsd: 0, inputTokens: 0, outputTokens: 0 },
  };
  
  const byProject = Array.from(projectMap.entries())
    .map(([cwd, data]) => ({ cwd, sessions: data.sessions, costUsd: data.costUsd }))
    .sort((a, b) => b.sessions - a.sessions);
  
  const tokens: StatsTokens = {
    input: totalInputTokens,
    output: totalOutputTokens,
    total: totalInputTokens + totalOutputTokens,
  };
  
  const avgCostPerSessionUsd = sessionsWithCostData > 0 
    ? totalCostUsd / sessionsWithCostData 
    : 0;
  
  return {
    period,
    sessions: {
      total: sessions.length,
      withCostData: sessionsWithCostData,
    },
    tokens,
    costUsd: totalCostUsd,
    avgCostPerSessionUsd,
    byModel,
    byRole,
    byProject,
  };
}

/**
 * Render human-readable stats output
 */
function renderHumanReadable(stats: StatsOutput, options: StatsOptions): string {
  const lines: string[] = [];
  const brand = chalk.hex("#D77757");
  const dim = chalk.dim;
  
  // Header
  const periodText = options.all 
    ? "all time" 
    : `last ${stats.period.days} days`;
  
  lines.push();
  lines.push(`  ${brand("◆")} ${chalk.bold("WorkerMill Usage")} ${dim(`— ${periodText}`)}`);
  lines.push();
  
  // Summary stats
  const sessionNote = stats.sessions.withCostData < stats.sessions.total 
    ? ` (${stats.sessions.total - stats.sessions.withCostData} sessions without cost data)` 
    : "";
  
  lines.push(`  ${chalk.bold("Sessions")}          ${formatNumber(stats.sessions.total)}${sessionNote}`);
  lines.push(`  ${chalk.bold("Total cost")}       ${formatUSD(stats.costUsd)}`);
  
  const totalTokens = stats.tokens.total;
  const inputTokens = stats.tokens.input;
  const outputTokens = stats.tokens.output;
  lines.push(`  ${chalk.bold("Total tokens")}      ${formatTokens(totalTokens)}  (${formatTokens(inputTokens)} in / ${formatTokens(outputTokens)} out)`);
  lines.push(`  ${chalk.bold("Avg per session")}  ${formatUSD(stats.avgCostPerSessionUsd)}`);
  
  // Note about sessions without cost data
  if (stats.sessions.withCostData < stats.sessions.total && stats.sessions.total > 0) {
    lines.push();
    lines.push(dim(`  ℹ Cost data is only available for ${stats.sessions.withCostData} of ${stats.sessions.total} sessions.`));
    lines.push(dim(`    Older sessions or sessions from before cost tracking were added don't include cost information.`));
  }
  
  // By model
  if (stats.byModel.length > 0) {
    lines.push();
    lines.push(`  ${chalk.bold("By model")}`);
    
    for (const model of stats.byModel) {
      const pct = calcPercentage(model.costUsd, stats.costUsd);
      const pctStr = pct >= 1 ? `${Math.round(pct)}%` : "<1%";
      const totalModelTokens = model.inputTokens + model.outputTokens;
      
      const modelDisplay = model.model.startsWith("claude") 
        ? model.model 
        : model.key;
        
      lines.push(
        `    ${chalk.reset(modelDisplay).padEnd(25)} ${formatUSD(model.costUsd).padStart(8)} ${chalk.gray(pctStr).padStart(6)} ${formatTokens(totalModelTokens)} tokens`
      );
    }
  }
  
  // By role
  lines.push();
  lines.push(`  ${chalk.bold("By role")}`);
  
  const roleNames: { [key: string]: string } = {
    worker: "Worker",
    planner: "Planner",
    reviewer: "Reviewer",
  };
  
  for (const [roleName, roleData] of Object.entries(stats.byRole)) {
    const pct = calcPercentage(roleData.costUsd, stats.costUsd);
    const pctStr = pct >= 1 ? `${Math.round(pct)}%` : "<1%";
    
    lines.push(
      `    ${chalk.reset(roleNames[roleName]).padEnd(15)} ${formatUSD(roleData.costUsd).padStart(8)} ${chalk.gray(pctStr)}`
    );
  }
  
  // Most active projects
  if (stats.byProject.length > 0) {
    lines.push();
    lines.push(`  ${chalk.bold("Most active projects")}`);
    
    for (const project of stats.byProject.slice(0, 10)) {
      const cwd = project.cwd;
      const shortCwd = cwd.length > 40 ? "..." + cwd.slice(-37) : cwd;
      
      lines.push(
        `    ${chalk.reset(shortCwd).padEnd(35)} ${chalk.gray(`${project.sessions} sessions`)} ${formatUSD(project.costUsd)}`
      );
    }
  }
  
  lines.push();
  
  return lines.join("\n");
}

/**
 * Render JSON stats output
 */
function renderJson(stats: StatsOutput): string {
  return JSON.stringify(stats, null, 2);
}

/**
 * Handle empty stats (no sessions found)
 */
function handleEmptyStats(options: StatsOptions): void {
  if (options.json) {
    const period: StatsPeriod = {
      days: options.days ?? 30,
      from: new Date(Date.now() - ((options.days ?? 30) * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
    };
    
    const emptyStats: StatsOutput = {
      period,
      sessions: { total: 0, withCostData: 0 },
      tokens: { input: 0, output: 0, total: 0 },
      costUsd: 0,
      avgCostPerSessionUsd: 0,
      byModel: [],
      byRole: {
        worker: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
        planner: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
        reviewer: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
      },
      byProject: [],
    };
    
    console.log(renderJson(emptyStats));
    process.exit(0);
  }
  
  const periodText = options.all 
    ? "all time" 
    : `last ${options.days ?? 30} days`;
    
  console.log();
  console.log(`  No sessions found for the last ${periodText}.`);
  console.log();
  process.exit(0);
}

/**
 * Main stats command handler
 */
export function handleStatsCommand(options: StatsOptions): void {
  // Get all session files
  const sessionFiles = getAllSessionFiles();
  
  if (sessionFiles.length === 0) {
    handleEmptyStats(options);
    return;
  }
  
  // Load sessions
  const sessions = sessionFiles
    .map(({ filePath, cwd }) => {
      const session = loadSessionFile(filePath);
      if (session) {
        return { session, cwd };
      }
      return null;
    })
    .filter(Boolean) as Array<{ session: Session; cwd: string }>;
  
  // Filter sessions
  const filteredSessions = filterSessions(sessions, options);
  
  if (filteredSessions.length === 0) {
    handleEmptyStats(options);
    return;
  }
  
  // Aggregate stats
  const stats = aggregateStats(filteredSessions);
  
  // Output
  if (options.json) {
    console.log(renderJson(stats));
    process.exit(0);
  }
  
  console.log(renderHumanReadable(stats, options));
  process.exit(0);
}
