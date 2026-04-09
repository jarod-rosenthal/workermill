/**
 * CLI subcommand: wm runs — inspect past /build run manifests.
 *
 * Usage:
 *   wm runs              — list recent runs
 *   wm runs list         — same as above
 *   wm runs show <id>    — full details for a specific run
 *   wm runs last         — show the most recent run
 */

import chalk from "chalk";
import { listRunManifests, loadRunManifest, type RunManifest } from "./run-manifest.js";

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return iso.slice(0, 16);
  }
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "success": return chalk.green("✓ success");
    case "partial": return chalk.yellow("◐ partial");
    case "failed": return chalk.red("✗ failed");
    case "cancelled": return chalk.gray("⊘ cancelled");
    default: return outcome;
  }
}

function storyStatusIcon(status: string): string {
  switch (status) {
    case "completed": return chalk.green("✓");
    case "failed": return chalk.red("✗");
    case "skipped": return chalk.gray("⊘");
    default: return "?";
  }
}

export function runsList(options: { json?: boolean }): void {
  const runs = listRunManifests(undefined, 20);

  if (runs.length === 0) {
    console.log("No build runs found. Run /build to create one.");
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(runs, null, 2));
    return;
  }

  console.log(chalk.bold("\nRecent /build runs:\n"));

  for (const run of runs) {
    const completed = run.stories.filter(s => s.status === "completed").length;
    const total = run.stories.length;
    const date = run.startedAt ? formatDate(run.startedAt) : "unknown";
    const cost = run.totalCost > 0 ? ` · $${run.totalCost.toFixed(2)}` : "";
    const branch = run.featureBranch ? ` · ${run.featureBranch}` : "";

    console.log(
      `  ${chalk.dim(run.id)}  ${date}  ${outcomeLabel(run.outcome)}  ${completed}/${total} stories${cost}${branch}`
    );
  }
  console.log();
}

export function runsShow(idOrPrefix: string, options: { json?: boolean }): void {
  // Support prefix matching
  const runs = listRunManifests(undefined, 100);
  const match = runs.find(r => r.id === idOrPrefix || r.id.startsWith(idOrPrefix));

  if (!match) {
    console.error(`Run "${idOrPrefix}" not found. Use \`wm runs list\` to see available runs.`);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(match, null, 2));
    return;
  }

  printRunDetails(match);
}

export function runsLast(options: { json?: boolean }): void {
  const runs = listRunManifests(undefined, 1);

  if (runs.length === 0) {
    console.log("No build runs found.");
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(runs[0], null, 2));
    return;
  }

  printRunDetails(runs[0]);
}

function printRunDetails(run: RunManifest): void {
  const completed = run.stories.filter(s => s.status === "completed").length;
  const failed = run.stories.filter(s => s.status === "failed").length;
  const skipped = run.stories.filter(s => s.status === "skipped").length;

  console.log();
  console.log(chalk.bold(`Build Run: ${run.id}`));
  console.log();
  console.log(`  Outcome:    ${outcomeLabel(run.outcome)}`);
  console.log(`  Started:    ${run.startedAt ? formatDate(run.startedAt) : "unknown"}`);
  if (run.completedAt) {
    console.log(`  Completed:  ${formatDate(run.completedAt)}`);
    const durationMs = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
    if (durationMs > 0) {
      const mins = Math.floor(durationMs / 60000);
      const secs = Math.round((durationMs % 60000) / 1000);
      console.log(`  Duration:   ${mins}m ${secs}s`);
    }
  }
  if (run.featureBranch) console.log(`  Branch:     ${run.featureBranch}`);
  if (run.mainBranch) console.log(`  Base:       ${run.mainBranch}`);
  if (run.ticketKey) console.log(`  Ticket:     ${run.ticketKey}`);
  console.log(`  Cost:       $${run.totalCost.toFixed(2)}`);
  console.log(`  Tokens:     ${run.totalInputTokens.toLocaleString()} in · ${run.totalOutputTokens.toLocaleString()} out`);
  console.log();

  // Stories
  console.log(chalk.bold("  Stories:"));
  for (let i = 0; i < run.stories.length; i++) {
    const s = run.stories[i];
    const icon = storyStatusIcon(s.status);
    const retry = s.retryCount > 0 ? chalk.dim(` (${s.retryCount} retries)`) : "";
    const failCode = s.failureCode ? chalk.red(` [${s.failureCode}]`) : "";
    console.log(`    ${icon} ${i + 1}. ${s.title} (${s.persona})${retry}${failCode}`);
  }
  console.log(`    ${completed} passed · ${failed} failed · ${skipped} skipped`);

  // Gates
  if (run.gates.length > 0) {
    console.log();
    console.log(chalk.bold("  Quality Gates:"));
    for (const g of run.gates) {
      const icon = g.passed ? chalk.green("✓") : chalk.red("✗");
      console.log(`    ${icon} ${g.name}`);
    }
  }

  // Reviews
  if (run.reviews.length > 0) {
    console.log();
    console.log(chalk.bold("  Reviews:"));
    for (const r of run.reviews) {
      const icon = r.decision === "approved" ? chalk.green("✓") : chalk.red("✗");
      console.log(`    ${icon} Round ${r.round}: ${r.score}/10 (${r.decision}) — ${r.provider}/${r.model}`);
    }
  }

  console.log();

  // Task preview
  if (run.userTask) {
    const preview = run.userTask.split("\n")[0].slice(0, 100);
    console.log(chalk.dim(`  Task: ${preview}${run.userTask.length > 100 ? "..." : ""}`));
    console.log();
  }
}
