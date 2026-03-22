import type { APIRequestContext } from "@playwright/test";

export interface IntegrationConfig {
  // AI Providers
  hasOllama: boolean;
  hasAnthropic: boolean;
  hasOpenAI: boolean;
  hasGoogle: boolean;

  // SCM Providers
  hasGitHub: boolean;
  hasGitLab: boolean;
  hasBitbucket: boolean;

  // Ticket Systems
  hasJira: boolean;
  hasLinear: boolean;
  hasGitHubIssues: boolean;

  // Raw settings for restore
  originalSettings: Record<string, unknown>;
}

const API_URL = "http://localhost:3001";

export async function detectIntegrations(
  request: APIRequestContext,
): Promise<IntegrationConfig> {
  const response = await request.get(`${API_URL}/api/settings`);
  const settings = response.ok() ? await response.json() : {};

  // Check Ollama reachability
  let hasOllama = false;
  const ollamaUrl = settings.ollamaBaseUrl;
  if (ollamaUrl) {
    try {
      const ollamaResponse = await fetch(`${ollamaUrl}/api/tags`);
      hasOllama = ollamaResponse.ok;
    } catch {
      hasOllama = false;
    }
  }

  return {
    hasOllama,
    hasAnthropic: !!settings.hasPlanningApiKey || !!process.env.ANTHROPIC_API_KEY,
    hasOpenAI: !!settings.openaiApiKey || !!process.env.OPENAI_API_KEY,
    hasGoogle: !!settings.googleApiKey || !!process.env.GOOGLE_API_KEY,

    hasGitHub: settings.scmProvider === "github",
    hasGitLab: !!settings.gitlabBaseUrl && !!settings.gitlabToken,
    hasBitbucket: !!settings.bitbucketWorkspace,

    hasJira: !!settings.jiraBaseUrl && !!settings.jiraApiToken,
    hasLinear: !!settings.linearApiKey,
    hasGitHubIssues: settings.issueTrackerProvider === "github",

    originalSettings: settings,
  };
}
