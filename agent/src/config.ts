/**
 * Remote Agent Configuration
 *
 * Loads .env.remote and validates prerequisites (Docker, Claude CLI, worker image).
 */

import { existsSync } from "fs";
import { execSync } from "child_process";
import { hostname } from "os";

export interface AgentConfig {
  apiUrl: string;
  apiKey: string;
  agentId: string;
  maxWorkers: number;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  githubToken: string;
  bitbucketToken: string;
  gitlabToken: string;
}

export function loadConfig(): AgentConfig {
  const apiUrl = process.env.WORKERMILL_API_URL;
  const apiKey = process.env.WORKERMILL_API_KEY;

  if (!apiUrl) {
    console.error("WORKERMILL_API_URL is required in .env.remote");
    process.exit(1);
  }

  if (!apiKey) {
    console.error("WORKERMILL_API_KEY is required in .env.remote");
    console.error("Get your API key from Settings > Integrations on the WorkerMill dashboard.");
    process.exit(1);
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ""), // Strip trailing slash
    apiKey,
    agentId: process.env.AGENT_ID || `agent-${hostname()}`,
    maxWorkers: parseInt(process.env.MAX_WORKERS || "2", 10),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "5000", 10),
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || "30000", 10),
    githubToken: process.env.GITHUB_TOKEN || "",
    bitbucketToken: process.env.BITBUCKET_TOKEN || "",
    gitlabToken: process.env.GITLAB_TOKEN || "",
  };
}

export function validatePrerequisites(): void {
  // Check Docker
  try {
    execSync("docker version", { stdio: "ignore" });
  } catch {
    console.error("Docker is not available. Please install Docker and ensure it's running.");
    process.exit(1);
  }

  // Check worker image
  try {
    execSync("docker image inspect workermill-worker:local", { stdio: "ignore" });
  } catch {
    console.error("Worker image 'workermill-worker:local' not found.");
    console.error("Build it with: ./bin/local-workermill build-worker");
    process.exit(1);
  }

  // Check Claude CLI
  try {
    execSync("claude --version", { stdio: "ignore" });
  } catch {
    console.error("Claude CLI is not installed.");
    console.error("Install it with: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }

  // Check Claude credentials
  const homedir = process.env.HOME || process.env.USERPROFILE || "";
  const credsPath = `${homedir}/.claude/.credentials.json`;
  if (!existsSync(credsPath)) {
    console.error("Claude credentials not found.");
    console.error("Run 'claude auth login' to authenticate.");
    process.exit(1);
  }
}
