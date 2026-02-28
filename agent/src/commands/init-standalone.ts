/**
 * workermill-agent init --standalone
 *
 * Interactive setup for standalone (non-cloud) mode.
 * Configures LLM API key, default repo, and SCM token.
 */

import chalk from "chalk";
import inquirer from "inquirer";
import { loadStandaloneConfig, saveStandaloneConfig, type StandaloneConfig } from "../backends/local/config.js";

export async function initStandaloneCommand(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("  WorkerMill Standalone Setup"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log();
  console.log("  Configure WorkerMill to run fully offline with your own AI keys.");
  console.log("  You can connect to workermill.com later for premium features.");
  console.log();

  const existing = loadStandaloneConfig();

  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "llmProvider",
      message: "LLM provider:",
      choices: [
        { name: "Anthropic (Claude)", value: "anthropic" },
        { name: "OpenAI (GPT)", value: "openai" },
        { name: "Google (Gemini)", value: "google" },
      ],
      default: existing.llm?.provider || "anthropic",
    },
    {
      type: "input",
      name: "llmModel",
      message: "Model name:",
      default: (answers: any) => {
        if (answers.llmProvider === "anthropic") return existing.llm?.model || "claude-sonnet-4-20250514";
        if (answers.llmProvider === "openai") return "gpt-4o";
        if (answers.llmProvider === "google") return "gemini-2.5-pro";
        return "";
      },
    },
    {
      type: "password",
      name: "llmApiKey",
      message: "API key:",
      mask: "*",
      validate: (input: string) => input.length > 0 || "API key is required",
    },
    {
      type: "input",
      name: "defaultRepo",
      message: "Default repository (e.g., https://github.com/user/repo):",
      default: existing.defaultRepo || "",
    },
    {
      type: "list",
      name: "scmProvider",
      message: "SCM provider:",
      choices: [
        { name: "GitHub", value: "github" },
        { name: "Bitbucket", value: "bitbucket" },
        { name: "GitLab", value: "gitlab" },
      ],
      default: existing.scm?.provider || "github",
    },
    {
      type: "password",
      name: "scmToken",
      message: "SCM token (for pushing branches/PRs):",
      mask: "*",
    },
  ]);

  const config: StandaloneConfig = {
    mode: "standalone",
    llm: {
      provider: answers.llmProvider,
      model: answers.llmModel,
      apiKey: answers.llmApiKey,
    },
    scm: {
      provider: answers.scmProvider,
      token: answers.scmToken || "",
    },
    defaultRepo: answers.defaultRepo || undefined,
    settings: existing.settings || {
      maxParallelExperts: 4,
      maxStories: 8,
    },
  };

  saveStandaloneConfig(config);

  console.log();
  console.log(`  ${chalk.green("✓")} Configuration saved to ~/.workermill/config.json`);
  console.log();
  console.log(`  Run ${chalk.cyan("workermill-agent")} to start the agent.`);
  console.log();
}
