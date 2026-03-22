import type React from "react";

export const API_BASE = import.meta.env.VITE_API_URL || "";

// Types
export interface IntegrationStatus {
  connected: boolean;
  lastChecked: string | null;
  webhookSecretConfigured?: boolean;
  reviewerTokenConfigured?: boolean;
}

export interface AIProviderStatus {
  configured: boolean;
  lastTested: string | null;
  error?: string;
}

export interface AIProviderState {
  apiKey: string;
  visible: boolean;
  testing: boolean;
  saving: boolean;
  status: AIProviderStatus;
}

export interface ProviderRoutingConfig {
  provider: string;
  model?: string;
}

export interface EmailPreferences {
  taskCompleted?: boolean;
  taskFailed?: boolean;
  costAlerts?: boolean;
  prCreated?: boolean;
  frequency?: "immediate" | "daily" | "weekly" | "never";
}

export interface Settings {
  apiKeyPrefix?: string | null;
  logRetentionDays: number;
  taskRetentionDays: number;
  maxConcurrentWorkers: number;
  maxParallelExperts: number;
  ralphMaxStories: number;
  defaultMaxRetries: number;
  taskCooldownSeconds: number;
  defaultWorkerModel: string;
  defaultWorkerPersona: string;
  aiGuidelines: string | null;
  primaryProvider: string;
  providerRouting: Record<string, ProviderRoutingConfig>;
  ollamaBaseUrl: string | null;
  ollamaContextWindow: number;
  managerProvider: string;
  managerModelId: string;
  maxReviewRevisions: number;
  maxPerStoryRevisions: number;
  // Planning Agent (Project Manager) settings
  planningAgentProvider: string;
  planningAgentModel: string;
  planningMode: string;
  prdPlanningMode: string;
  criticApprovalThreshold: number;
  maxTargetFiles: number;
  storyCalibrationMultiplier: number;
  costAlertThresholdUsd: number | null;
  // Budget Limits (AI FinOps)
  dailyBudgetLimitUsd: number | null;
  weeklyBudgetLimitUsd: number | null;
  monthlyBudgetLimitUsd: number | null;
  perTaskCostCeilingUsd: number | null;
  // SCM Provider settings
  scmProvider: "github" | "gitlab" | "bitbucket";
  scmBaseUrl: string | null;
  // Issue Tracker Provider settings
  issueTrackerProvider: "jira" | "linear" | "github-issues" | "internal";
  completedTaskDisplayMinutes: number;
  intermediateTaskDisplayMinutes: number;
  dryRunVisibilityMinutes: number;
  // Email notification settings
  emailNotificationsEnabled: boolean;
  emailFromAddress: string | null;
  defaultEmailPreferences: EmailPreferences;
  // Auto-workflow settings
  autoReviewEnabled: boolean;
  autoDeployEnabled: boolean;
  autoImproveEnabled: boolean;
  autoSkillExtraction: boolean;
  prdAutoRun: boolean;
  remoteAgentOnly: boolean;
  // Warm Container Pool settings
  warmPoolSize: number;
  warmPoolHoursStart: number;
  warmPoolHoursEnd: number;
  warmPoolTimezone: string;
  // Quality Gate settings
  qualityGateEnabled: boolean;
  minQualityScore: number | null;
  minTestCoveragePercent: number | null;
  maxSecurityHighVulns: number | null;
  blockOnTypeErrors: boolean;
  blockOnTestFailures: boolean;
  blockOnLintErrors: boolean;
  blockOnE2EFailures: boolean;
  // External Quality Tools
  sonarqubeUrl: string | null;
  sonarqubeToken: string | null;
  coderabbitEnabled: boolean;
  coderabbitApiKey: string | null;
  deepsourceEnabled: boolean;
  deepsourceToken: string | null;
  qualityWebhookUrl: string | null;
  qualityWebhookSecret: string | null;
  // Auto-Fix settings
  autoFixEnabled: boolean;
  autoFixMaxIterations: number;
  // Resilience settings
  blockerMaxAutoRetries: number;
  blockerAutoRetryEnabled: boolean;
  maxFixRetries: number;
  blockerWaitTimeoutMinutes: number;
  pushAfterCommit: boolean;
  gracefulShutdownEnabled: boolean;
  selfReviewEnabled: boolean;
  // Repository list
  repositories: string[];
  // Codebase RAG settings
  codebaseIndexingEnabled: boolean;
  codebaseMaxFilesPerRepo: number;
  codebaseMaxFileSizeKb: number;
  codebaseExcludePatterns: string[];
  codebaseIncludeLanguages: string[];
  codebaseAutoIndexOnTask: boolean;
  codebaseMaxRetrievalChunks: number;
  // Agent execution limits
  maxAgentTurns: number | null;
  // Spec Engineering settings
  specMinQualityScore: number;
  specRequiredSections: string[] | null;
}

export interface ValidationErrors {
  logRetentionDays?: string;
  taskRetentionDays?: string;
  maxConcurrentWorkers?: string;
  maxParallelExperts?: string;
  ralphMaxStories?: string;
  defaultMaxRetries?: string;
  taskCooldownSeconds?: string;
  costAlertThresholdUsd?: string;
  dailyBudgetLimitUsd?: string;
  weeklyBudgetLimitUsd?: string;
  monthlyBudgetLimitUsd?: string;
  perTaskCostCeilingUsd?: string;
  completedTaskDisplayMinutes?: string;
  intermediateTaskDisplayMinutes?: string;
  dryRunVisibilityMinutes?: string;
  ollamaContextWindow?: string;
  minQualityScore?: string;
  minTestCoveragePercent?: string;
  maxSecurityHighVulns?: string;
  autoFixMaxIterations?: string;
  sonarqubeUrl?: string;
  qualityWebhookUrl?: string;
}

export interface TeamMember {
  id: string;
  email: string;
  fullName: string | null;
  role: "admin" | "member" | "viewer";
  status: string;
  createdAt: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: "admin" | "member" | "viewer";
  expiresAt: string;
  createdAt: string;
}

export interface UsageData {
  tasks: {
    used: number;
    quota: number;
    percent: number;
    isUnlimited: boolean;
  };
  plan: string;
  billingPeriod: {
    start: string | null;
    daysUntilReset: number;
  };
}

export type SettingsCategory =
  | "general"
  | "team"
  | "ai-workers"
  | "quality"
  | "integrations"
  | "remote-agent"
  | "billing"
  | "notifications"
  | "data";

export interface NavItem {
  id: SettingsCategory;
  label: string;
  icon: React.ReactNode;
  href?: string;
}

export interface ExternalLinkItem {
  label: string;
  icon: React.ReactNode;
  href: string;
}

export interface ProviderOption {
  value: string;
  label: string;
  icon: string;
}

export interface ModelOption {
  value: string;
  label: string;
  tier: string;
}

export interface PersonaOption {
  value: string;
  label: string;
}

export const PROVIDER_OPTIONS: ProviderOption[] = [
  { value: "anthropic", label: "Anthropic (Claude)", icon: "🤖" },
  { value: "openai", label: "OpenAI (GPT)", icon: "🔷" },
  { value: "google", label: "Google (Gemini)", icon: "🔵" },
  { value: "openrouter", label: "OpenRouter (Multi)", icon: "🔀" },
  { value: "groq", label: "Groq (Fast)", icon: "⚡" },
  { value: "deepseek", label: "DeepSeek", icon: "🔍" },
  { value: "mistral", label: "Mistral AI", icon: "🌀" },
  { value: "xai", label: "xAI (Grok)", icon: "𝕏" },
  { value: "bedrock", label: "AWS Bedrock", icon: "☁️" },
  { value: "azure", label: "Azure AI Foundry", icon: "🔶" },
  { value: "ollama", label: "Ollama (Local)", icon: "🏠" },
];

export const MODEL_OPTIONS: Record<string, ModelOption[]> = {
  anthropic: [
    { value: "claude-opus-4-6", label: "Claude Opus 4.6", tier: "Powerful" },
    {
      value: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      tier: "Balanced",
    },
    {
      value: "claude-haiku-4-5-20251001",
      label: "Claude Haiku 4.5",
      tier: "Fast",
    },
  ],
  openai: [
    { value: "gpt-5.2", label: "GPT-5.2", tier: "Powerful" },
    { value: "o3-pro", label: "o3 Pro (Reasoning)", tier: "Powerful" },
    { value: "gpt-5-mini", label: "GPT-5 Mini", tier: "Fast" },
  ],
  google: [
    {
      value: "gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro",
      tier: "Powerful",
    },
    {
      value: "gemini-3-pro-preview",
      label: "Gemini 3 Pro",
      tier: "Balanced",
    },
    {
      value: "gemini-3-flash-preview",
      label: "Gemini 3 Flash",
      tier: "Fast",
    },
  ],
  openrouter: [
    {
      value: "anthropic/claude-sonnet-4",
      label: "Claude Sonnet 4 (via OR)",
      tier: "Balanced",
    },
    {
      value: "openai/gpt-4o",
      label: "GPT-4o (via OR)",
      tier: "Balanced",
    },
    {
      value: "google/gemini-2.5-flash",
      label: "Gemini 2.5 Flash (via OR)",
      tier: "Balanced",
    },
    {
      value: "deepseek/deepseek-r1",
      label: "DeepSeek R1 (via OR)",
      tier: "Powerful",
    },
    {
      value: "meta-llama/llama-3.3-70b-instruct",
      label: "Llama 3.3 70B (via OR)",
      tier: "Powerful",
    },
    {
      value: "mistralai/mistral-large",
      label: "Mistral Large (via OR)",
      tier: "Powerful",
    },
  ],
  groq: [
    {
      value: "llama-3.3-70b-versatile",
      label: "Llama 3.3 70B",
      tier: "Powerful",
    },
    {
      value: "llama-3.1-8b-instant",
      label: "Llama 3.1 8B Instant",
      tier: "Fast",
    },
    {
      value: "mixtral-8x7b-32768",
      label: "Mixtral 8x7B",
      tier: "Balanced",
    },
    { value: "gemma2-9b-it", label: "Gemma 2 9B", tier: "Fast" },
  ],
  deepseek: [
    {
      value: "deepseek-chat",
      label: "DeepSeek Chat",
      tier: "Balanced",
    },
    {
      value: "deepseek-reasoner",
      label: "DeepSeek Reasoner",
      tier: "Powerful",
    },
  ],
  mistral: [
    {
      value: "mistral-large-latest",
      label: "Mistral Large",
      tier: "Powerful",
    },
    {
      value: "mistral-medium-latest",
      label: "Mistral Medium",
      tier: "Balanced",
    },
    {
      value: "mistral-small-latest",
      label: "Mistral Small",
      tier: "Fast",
    },
    {
      value: "codestral-latest",
      label: "Codestral (Code)",
      tier: "Balanced",
    },
    {
      value: "pixtral-large-latest",
      label: "Pixtral Large (Vision)",
      tier: "Powerful",
    },
  ],
  xai: [
    { value: "grok-3", label: "Grok 3", tier: "Powerful" },
    { value: "grok-3-fast", label: "Grok 3 Fast", tier: "Balanced" },
    { value: "grok-2", label: "Grok 2", tier: "Balanced" },
  ],
  bedrock: [
    {
      value: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      label: "Claude 3.5 Sonnet v2",
      tier: "Balanced",
    },
    {
      value: "anthropic.claude-3-5-haiku-20241022-v1:0",
      label: "Claude 3.5 Haiku",
      tier: "Fast",
    },
    {
      value: "meta.llama3-3-70b-instruct-v1:0",
      label: "Llama 3.3 70B",
      tier: "Powerful",
    },
    {
      value: "mistral.mistral-large-2411-v1:0",
      label: "Mistral Large",
      tier: "Powerful",
    },
    {
      value: "amazon.titan-text-premier-v1:0",
      label: "Titan Text Premier",
      tier: "Balanced",
    },
  ],
  azure: [
    { value: "gpt-4o", label: "GPT-4o", tier: "Balanced" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini", tier: "Fast" },
    { value: "o1", label: "o1 (Reasoning)", tier: "Powerful" },
    { value: "o1-mini", label: "o1 Mini", tier: "Balanced" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo", tier: "Powerful" },
  ],
  ollama: [
    {
      value: "qwen3-coder:30b",
      label: "Qwen 3 Coder 30B",
      tier: "Recommended",
    },
    {
      value: "qwen2.5-coder:14b",
      label: "Qwen 2.5 Coder 14B",
      tier: "Balanced",
    },
    {
      value: "qwen2.5:14b-instruct-q4_K_M",
      label: "Qwen 2.5 14B Instruct",
      tier: "Balanced",
    },
    {
      value: "devstral-small-2:24b-instruct-2512-q8_0",
      label: "Devstral Small 24B",
      tier: "Balanced",
    },
    {
      value: "deepseek-r1:70b",
      label: "DeepSeek R1 70B",
      tier: "Powerful",
    },
    { value: "llama3.3:70b", label: "Llama 3.3 70B", tier: "Powerful" },
    {
      value: "mistral:7b-instruct",
      label: "Mistral 7B Instruct",
      tier: "Fast",
    },
    { value: "llama3.1:8b", label: "Llama 3.1 8B", tier: "Fast" },
  ],
};

export const PERSONA_OPTIONS: PersonaOption[] = [
  { value: "auto", label: "Auto (Dynamic Routing)" },
  { value: "frontend_developer", label: "Frontend Developer" },
  { value: "backend_developer", label: "Backend Developer" },
  { value: "architect", label: "\u{1F3D7}\uFE0F Architect" },
  { value: "devops_engineer", label: "DevOps Engineer" },
  { value: "security_engineer", label: "Security Engineer" },
  { value: "qa_engineer", label: "QA Engineer" },
  { value: "tech_writer", label: "Technical Writer" },
  { value: "project_manager", label: "Project Manager" },
  { value: "manager", label: "Manager" },
  { value: "data_ml_engineer", label: "\u{1F4CA} Data & ML Engineer" },
  { value: "mobile_developer", label: "\u{1F4F1} Mobile Developer" },
  { value: "support_agent", label: "Support Agent" },
  { value: "tech_lead", label: "Tech Lead" },
];
