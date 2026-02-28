/**
 * workermill-agent prd --repo <url> --file prd.md
 *
 * Decomposes a PRD into a board with cards in standalone mode.
 */

import chalk from "chalk";
import { readFileSync } from "fs";
import { getBackend, resetBackend } from "../backends/selector.js";
import { isStandaloneReady } from "../backends/local/config.js";

export async function prdStandaloneCommand(opts: {
  repo?: string;
  file?: string;
  content?: string;
}): Promise<void> {
  if (!isStandaloneReady()) {
    console.error(chalk.red("Not configured. Run 'workermill-agent init --standalone' first."));
    process.exit(1);
  }

  let prdContent: string;
  if (opts.file) {
    try {
      prdContent = readFileSync(opts.file, "utf-8");
    } catch {
      console.error(chalk.red(`Failed to read file: ${opts.file}`));
      process.exit(1);
    }
  } else if (opts.content) {
    prdContent = opts.content;
  } else {
    console.error(chalk.red("--file or --content is required."));
    process.exit(1);
  }

  console.log(chalk.bold.cyan("  WorkerMill — PRD Decomposition"));
  console.log();

  const backend = await getBackend();

  const board = await backend.decomposePrd(
    { content: prdContent, repo: opts.repo, scmProvider: undefined },
    (msg) => console.log(`  ${msg}`),
  );

  console.log();
  console.log(`  ${chalk.green("✓")} Board created: ${chalk.bold(board.name)}`);
  console.log(`  ${chalk.dim("ID:")} ${board.id}`);
  console.log();

  await resetBackend();
}
