/**
 * Multi-Expert Coordinator Entry Point
 *
 * Multi-agent collaboration service using Vercel AI SDK.
 * Spawns multiple expert subagents that collaborate on a task,
 * each potentially using a different AI provider based on providerRouting.
 *
 * This is triggered when a task has the 'multi-expert' label and MULTI_EXPERT_MODE=true.
 */

import "dotenv/config";
import { spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import axios, { AxiosInstance } from "axios";

/**
 * Provider routing configuration.
 */
interface ProviderRouting {
  [persona: string]: {
    provider: string;
    model: string;
  };
}

/**
 * Multi-Expert configuration from environment.
 */
interface MultiExpertConfig {
  parentTaskId: string;
  apiBaseUrl: string;
  orgApiKey: string;
  anthropicApiKey: string;
  githubToken: string;
  targetRepo: string;
  model?: string;
  jiraIssueKey?: string;
  providerRouting?: ProviderRouting;
  googleApiKey?: string;
  openaiApiKey?: string;
  ollamaHost?: string;
}

/**
 * Story from coordination feed.
 */
interface Story {
  id: string;
  parentTaskId: string;
  storyIndex: number;
  persona: string;
  title: string;
  description: string;
  dependencies: number[];
  jiraIssueKey?: string;
}

// Provider icons for visibility
const PROVIDER_ICONS: Record<string, string> = {
  anthropic: "🤖",
  openai: "🔷",
  google: "🔵",
  gemini: "🔵",
  ollama: "🏠",
};

// Persona emojis for visibility
const PERSONA_EMOJIS: Record<string, string> = {
  frontend_developer: "🎨",
  backend_developer: "⚙️",
  devops_engineer: "🔧",
  security_engineer: "🔒",
  qa_engineer: "🧪",
  tech_writer: "📝",
  project_manager: "📋",
  api_developer: "🔌",
  database_administrator: "🗄️",
  ml_engineer: "🧠",
  data_engineer: "📊",
  mobile_developer_ios: "📱",
  mobile_developer_android: "🤖",
};

/**
 * Load configuration from environment variables.
 */
function loadConfig(): MultiExpertConfig {
  const required = [
    "PARENT_TASK_ID",
    "API_BASE_URL",
    "ORG_API_KEY",
    "ANTHROPIC_API_KEY",
    "GITHUB_TOKEN",
    "TARGET_REPO",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error("Missing required environment variables: " + missing.join(", "));
  }

  // Parse provider routing from JSON environment variable
  let providerRouting: ProviderRouting | undefined = undefined;
  if (process.env.PROVIDER_ROUTING) {
    try {
      providerRouting = JSON.parse(process.env.PROVIDER_ROUTING);
    } catch {
      console.warn("[Multi-Expert] Failed to parse PROVIDER_ROUTING, ignoring");
    }
  }

  return {
    parentTaskId: process.env.PARENT_TASK_ID!,
    apiBaseUrl: process.env.API_BASE_URL!,
    orgApiKey: process.env.ORG_API_KEY!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    githubToken: process.env.GITHUB_TOKEN!,
    targetRepo: process.env.TARGET_REPO!,
    model: process.env.WORKER_MODEL || process.env.MODEL,
    jiraIssueKey: process.env.JIRA_ISSUE_KEY || process.env.TICKET_KEY || "",
    providerRouting,
    googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    ollamaHost: process.env.OLLAMA_HOST,
  };
}

// Default models per provider
const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
  gemini: "gemini-2.0-flash",
  ollama: "qwen2.5-coder:32b",
};

/**
 * Get provider and model for a persona from routing or defaults.
 */
function getProviderForPersona(
  persona: string,
  config: MultiExpertConfig
): { provider: string; model: string } {
  const routing = config.providerRouting?.[persona];
  if (routing) {
    return { provider: routing.provider, model: routing.model };
  }
  // Default to Anthropic with Anthropic's default model
  // (Don't use config.model as it may be set to a non-Anthropic model)
  return {
    provider: "anthropic",
    model: PROVIDER_DEFAULT_MODELS.anthropic,
  };
}

/**
 * Get log prefix for visibility.
 */
function getLogPrefix(persona: string, provider: string): string {
  const emoji = PERSONA_EMOJIS[persona] || "🤖";
  const providerIcon = PROVIDER_ICONS[provider] || "🤖";
  return `[${emoji} ${persona} ${providerIcon}]`;
}

/**
 * Multi-Expert Coordinator
 */
class MultiExpertCoordinator {
  private config: MultiExpertConfig;
  private api: AxiosInstance;
  private repoPath: string = "/workspace/repo";
  private running: boolean = false;

  constructor(config: MultiExpertConfig) {
    this.config = config;
    this.api = axios.create({
      baseURL: config.apiBaseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.orgApiKey,
      },
      timeout: 30000,
    });
  }

  /**
   * Post a log message to the WorkerMill dashboard.
   */
  private async postLog(message: string, persona?: string, provider?: string): Promise<void> {
    const prefix = persona && provider ? getLogPrefix(persona, provider) : "[Multi-Expert]";
    console.log(`${prefix} ${message}`);

    try {
      await this.api.post("/api/control-center/logs", {
        taskId: this.config.parentTaskId,
        type: "output",
        message: `${prefix} ${message}`,
        severity: "info",
      });
    } catch {
      // Fire and forget
    }
  }

  /**
   * Clone the target repository.
   */
  private async cloneRepo(): Promise<void> {
    await this.postLog(`Cloning repository: ${this.config.targetRepo}`);

    return new Promise((resolve, reject) => {
      const cloneUrl = `https://x-access-token:${this.config.githubToken}@github.com/${this.config.targetRepo}.git`;
      const child = spawn("git", ["clone", cloneUrl, this.repoPath], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Git clone failed with code ${code}`));
        }
      });

      child.on("error", reject);
    });
  }

  /**
   * Fetch stories from the coordination context (story_ready messages).
   */
  private async fetchStories(): Promise<Story[]> {
    try {
      // Get story_ready context messages
      const readyResponse = await this.api.get(`/api/coordination/context/${this.config.parentTaskId}`, {
        params: { messageType: "story_ready" },
      });

      // Get story_claimed context messages to filter out already claimed
      const claimedResponse = await this.api.get(`/api/coordination/context/${this.config.parentTaskId}`, {
        params: { messageType: "story_claimed" },
      });

      const readyContexts = readyResponse.data.contexts || [];
      const claimedContexts = claimedResponse.data.contexts || [];

      // Build set of claimed story indices
      const claimedIndices = new Set(
        claimedContexts.map((c: { metadata?: { storyIndex?: number } }) => c.metadata?.storyIndex)
      );

      // Transform context messages into Story objects, filtering out claimed ones
      const stories: Story[] = [];
      for (const ctx of readyContexts) {
        const storyIndex = ctx.metadata?.storyIndex as number;
        if (claimedIndices.has(storyIndex)) {
          continue; // Already claimed
        }

        stories.push({
          id: ctx.id,
          parentTaskId: this.config.parentTaskId,
          storyIndex,
          persona: ctx.metadata?.persona || "backend_developer",
          title: ctx.metadata?.title || ctx.content,
          description: ctx.metadata?.description || "",
          dependencies: ctx.metadata?.dependencies || [],
          jiraIssueKey: this.config.jiraIssueKey,
        });
      }

      return stories;
    } catch (error) {
      console.error("[Multi-Expert] Failed to fetch stories:", error);
      return [];
    }
  }

  /**
   * Claim a story for execution via the coordination API.
   */
  private async claimStory(storyId: string, persona: string): Promise<boolean> {
    try {
      const response = await this.api.post("/api/coordination/claim", {
        storyId,
        claimedBy: persona,
        parentTaskId: this.config.parentTaskId,
      });
      return response.data.success;
    } catch (error) {
      console.error("[Multi-Expert] Failed to claim story:", error);
      return false;
    }
  }

  /**
   * Execute a story using the AI SDK executor.
   */
  private async executeStory(story: Story): Promise<{ success: boolean; error?: string }> {
    const { provider, model } = getProviderForPersona(story.persona, this.config);
    const prefix = getLogPrefix(story.persona, provider);

    await this.postLog(`Starting Story ${story.storyIndex}: ${story.title}`, story.persona, provider);
    await this.postLog(`Provider: ${provider} | Model: ${model}`, story.persona, provider);

    return new Promise((resolve) => {
      // Build environment with API keys
      // AGENT_WORKING_DIR tells the executor where to run file operations
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        AGENT_WORKING_DIR: this.repoPath,
        AGENT_MAX_STEPS: "100",
        AGENT_VERBOSE: "false",  // Cleaner output
      };

      // Set provider-specific API key
      if (provider === "anthropic") {
        env.ANTHROPIC_API_KEY = this.config.anthropicApiKey;
      } else if (provider === "google" || provider === "gemini") {
        // AI SDK expects GOOGLE_GENERATIVE_AI_API_KEY
        env.GOOGLE_GENERATIVE_AI_API_KEY = this.config.googleApiKey || "";
        env.GOOGLE_API_KEY = this.config.googleApiKey || "";
      } else if (provider === "openai") {
        env.OPENAI_API_KEY = this.config.openaiApiKey || "";
      } else if (provider === "ollama") {
        env.OLLAMA_HOST = this.config.ollamaHost || "http://localhost:11434";
      }

      // Build prompt from story
      const prompt = `
***REMOVED*** Story ${story.storyIndex}: ${story.title}

${story.description}

***REMOVED******REMOVED*** Instructions

You are the ${story.persona} expert. Complete this story by making the necessary code changes.
After completing the changes, commit them with a descriptive message.
`;

      // Write prompt to temp file
      const promptFile = `/tmp/multi-expert-prompt-${Date.now()}.txt`;
      writeFileSync(promptFile, prompt);

      const args = [
        "/app/agents/ai-sdk-executor.js",
        "--provider", provider,
        "--model", model,
        "--persona", story.persona,
        "--prompt-file", promptFile,
      ];

      // Run from /app so node can find AI SDK in /app/node_modules
      // The AGENT_WORKING_DIR env var tells the executor where to run file operations
      const child = spawn("node", args, {
        cwd: "/app",
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      child.stdout.on("data", (data) => {
        const text = data.toString();
        for (const line of text.split("\n")) {
          if (line.trim()) {
            console.log(line);
            // Forward agent output to dashboard (fire-and-forget)
            this.postLog(line, story.persona, provider).catch(() => {});
          }
        }
      });

      child.stderr.on("data", (data) => {
        const stderrText = data.toString().trim();
        if (stderrText) {
          // Only log actual errors, not warnings/info
          if (stderrText.includes("Error") || stderrText.includes("error:")) {
            console.error(`${prefix} ${stderrText}`);
            this.postLog(stderrText, story.persona, provider).catch(() => {});
          }
        }
      });

      child.on("close", (code) => {
        try {
          unlinkSync(promptFile);
        } catch {
          // Ignore cleanup errors
        }

        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: `AI SDK executor exited with code ${code}`,
          });
        }
      });

      child.on("error", (err) => {
        resolve({
          success: false,
          error: `Failed to spawn AI SDK executor: ${err.message}`,
        });
      });
    });
  }

  /**
   * Mark a story as completed by posting a completion context message.
   */
  private async completeStory(storyId: string, storyIndex: number, persona: string, success: boolean, error?: string): Promise<void> {
    try {
      const content = success
        ? `Story ${storyIndex} completed successfully`
        : `Story ${storyIndex} failed: ${error}`;

      await this.api.post("/api/coordination/context", {
        parentTaskId: this.config.parentTaskId,
        taskId: this.config.parentTaskId, // Use parent task ID since we don't have a separate task
        persona,
        messageType: "completion",
        content,
        metadata: {
          storyId,
          storyIndex,
          success,
          error: error || null,
          completedAt: new Date().toISOString(),
        },
      });
    } catch {
      console.error("[Multi-Expert] Failed to mark story as complete");
    }
  }

  /**
   * Start the coordinator.
   */
  async start(): Promise<void> {
    console.log("[Multi-Expert] Starting coordinator");
    console.log(`[Multi-Expert] Target: ${this.config.targetRepo}`);

    if (this.config.providerRouting) {
      const routingEntries = Object.entries(this.config.providerRouting);
      console.log(`[Multi-Expert] Provider routing: ${routingEntries.length} persona(s) configured`);
    }

    this.running = true;

    // Clone the repository
    await this.cloneRepo();
    await this.postLog("Repository cloned successfully");

    // Main execution loop
    let completedStories = 0;
    let failedStories = 0;

    while (this.running) {
      // Fetch available stories
      const stories = await this.fetchStories();
      const unclaimedStories = stories.filter((s) => !s.dependencies?.length);

      if (unclaimedStories.length === 0) {
        await this.postLog("No more stories to execute");
        break;
      }

      // Process one story at a time
      for (const story of unclaimedStories) {
        if (!this.running) break;

        // Try to claim the story
        const claimed = await this.claimStory(story.id, story.persona);
        if (!claimed) {
          continue;
        }

        // Execute the story
        const result = await this.executeStory(story);

        // Get provider for logging
        const { provider } = getProviderForPersona(story.persona, this.config);

        // Mark as complete
        await this.completeStory(story.id, story.storyIndex, story.persona, result.success, result.error);

        if (result.success) {
          completedStories++;
          await this.postLog(`Story ${story.storyIndex} completed!`, story.persona, provider);
        } else {
          failedStories++;
          await this.postLog(`Story ${story.storyIndex} failed: ${result.error}`, story.persona, provider);
        }
      }

      // Small delay between iterations
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Report final status
    await this.postLog(`Execution complete: ${completedStories} succeeded, ${failedStories} failed`);

    // Output markers for WorkerMill
    if (failedStories > 0) {
      console.log("::result::failed");
    } else {
      console.log("::result::review_requested");
    }
  }

  /**
   * Stop the coordinator.
   */
  stop(): void {
    this.running = false;
    console.log("[Multi-Expert] Stopping coordinator...");
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  console.log("[Multi-Expert] Multi-Provider AI Collaboration Service");

  try {
    const config = loadConfig();
    const coordinator = new MultiExpertCoordinator(config);

    // Handle graceful shutdown
    const shutdown = () => {
      console.log("\n[Multi-Expert] Received shutdown signal");
      coordinator.stop();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Start the coordinator
    await coordinator.start();

    console.log("[Multi-Expert] Session ended");
    process.exit(0);
  } catch (error) {
    console.error("[Multi-Expert] Fatal error:", error);
    process.exit(1);
  }
}

// Run
main();
