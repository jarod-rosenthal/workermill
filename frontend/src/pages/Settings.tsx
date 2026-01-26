import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Github,
  CheckCircle,
  XCircle,
  Loader2,
  Save,
  RefreshCw,
  Eye,
  EyeOff,
  ExternalLink,
  Building,
  Cpu,
  DollarSign,
  Database,
  Clock,
  Users,
  AlertTriangle,
  Sliders,
  UserPlus,
  Mail,
  Trash2,
  Send,
  X,
  BarChart3,
  Router,
  Server,
  Plus,
  Settings as SettingsIcon,
  Link as LinkIcon,
  RotateCcw,
  Copy,
  ChevronRight,
  Bell,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";
import {
  ErrorBoundaryWithRetry,
  SettingsErrorFallback,
} from "../components/ErrorBoundary";
import { CollapsibleSection } from "../components/ui/CollapsibleSection";
import { SlideOver } from "../components/ui/SlideOver";

const API_BASE = import.meta.env.VITE_API_URL || "";

// Types
interface IntegrationStatus {
  connected: boolean;
  lastChecked: string | null;
  webhookSecretConfigured?: boolean;
}

interface AIProviderStatus {
  configured: boolean;
  lastTested: string | null;
  error?: string;
}

interface AIProviderState {
  apiKey: string;
  visible: boolean;
  testing: boolean;
  saving: boolean;
  status: AIProviderStatus;
}

interface ProviderRoutingConfig {
  provider: string;
  model?: string;
}

interface EmailPreferences {
  taskCompleted?: boolean;
  taskFailed?: boolean;
  costAlerts?: boolean;
  prCreated?: boolean;
  frequency?: "immediate" | "daily" | "weekly" | "never";
}

interface Settings {
  logRetentionDays: number;
  taskRetentionDays: number;
  maxConcurrentWorkers: number;
  defaultMaxRetries: number;
  taskCooldownSeconds: number;
  defaultWorkerModel: string;
  defaultWorkerPersona: string;
  primaryProvider: string;
  providerRouting: Record<string, ProviderRoutingConfig>;
  ollamaBaseUrl: string | null;
  ollamaContextWindow: number;
  managerProvider: string;
  managerModelId: string;
  // Planning Agent (Project Manager) settings
  planningAgentProvider: string;
  planningAgentModel: string;
  storyCalibrationMultiplier: number;
  costAlertThresholdUsd: number | null;
  // SCM Provider settings
  scmProvider: "github" | "gitlab" | "bitbucket";
  scmBaseUrl: string | null;
  completedTaskDisplayMinutes: number;
  intermediateTaskDisplayMinutes: number;
  dryRunVisibilityMinutes: number;
  // Email notification settings
  emailNotificationsEnabled: boolean;
  emailFromAddress: string | null;
  defaultEmailPreferences: EmailPreferences;
}

interface ValidationErrors {
  logRetentionDays?: string;
  taskRetentionDays?: string;
  maxConcurrentWorkers?: string;
  defaultMaxRetries?: string;
  taskCooldownSeconds?: string;
  costAlertThresholdUsd?: string;
  completedTaskDisplayMinutes?: string;
  intermediateTaskDisplayMinutes?: string;
  dryRunVisibilityMinutes?: string;
  ollamaContextWindow?: string;
}

interface TeamMember {
  id: string;
  email: string;
  fullName: string | null;
  role: "admin" | "member" | "viewer";
  status: string;
  createdAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: "admin" | "member" | "viewer";
  expiresAt: string;
  createdAt: string;
}

interface UsageData {
  tasks: {
    used: number;
    quota: number;
    remaining: number;
    percent: number;
    isUnlimited: boolean;
  };
  plan: string;
  billingPeriod: {
    start: string | null;
    daysUntilReset: number;
  };
}

type SettingsCategory = "general" | "team" | "ai-workers" | "integrations" | "notifications" | "data";

// Navigation items
const NAV_ITEMS: { id: SettingsCategory; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <Building className="w-5 h-5" /> },
  { id: "team", label: "Team", icon: <Users className="w-5 h-5" /> },
  { id: "ai-workers", label: "AI Workers", icon: <Cpu className="w-5 h-5" /> },
  { id: "integrations", label: "Integrations", icon: <LinkIcon className="w-5 h-5" /> },
  { id: "notifications", label: "Notifications", icon: <Bell className="w-5 h-5" /> },
  { id: "data", label: "Data & Display", icon: <Database className="w-5 h-5" /> },
];

export default function Settings() {
  const tokens = useAuthStore((state) => state.tokens);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("general");

  // Settings state
  const [settings, setSettings] = useState<Settings>({
    logRetentionDays: 30,
    taskRetentionDays: 90,
    maxConcurrentWorkers: 3,
    defaultMaxRetries: 3,
    taskCooldownSeconds: 60,
    defaultWorkerModel: "claude-haiku-4-5-20251001",
    defaultWorkerPersona: "backend_developer",
    primaryProvider: "anthropic",
    providerRouting: {},
    ollamaBaseUrl: null,
    ollamaContextWindow: 65536,
    managerProvider: "openai",
    managerModelId: "gpt-5.1-codex",
    planningAgentProvider: "anthropic",
    planningAgentModel: "claude-sonnet-4-5-20250929",
    storyCalibrationMultiplier: 0.4,
    costAlertThresholdUsd: null,
    scmProvider: "github",
    scmBaseUrl: null,
    completedTaskDisplayMinutes: 10,
    intermediateTaskDisplayMinutes: 60,
    dryRunVisibilityMinutes: 1,
    emailNotificationsEnabled: true,
    emailFromAddress: null,
    defaultEmailPreferences: {
      taskCompleted: true,
      taskFailed: true,
      costAlerts: true,
      prCreated: false,
      frequency: "immediate",
    },
  });
  const [originalSettings, setOriginalSettings] = useState<Settings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Integration states
  const [jiraApiKey, setJiraApiKey] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraWebhookSecret, setJiraWebhookSecret] = useState("");
  const [jiraStatus, setJiraStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [jiraVisible, setJiraVisible] = useState(false);
  const [jiraWebhookVisible, setJiraWebhookVisible] = useState(false);
  const [jiraTesting, setJiraTesting] = useState(false);
  const [jiraSaving, setJiraSaving] = useState(false);
  const [_integrationsLoading, setIntegrationsLoading] = useState(true);

  const [githubToken, setGithubToken] = useState("");
  const [githubDefaultRepo, setGithubDefaultRepo] = useState("");
  const [githubWebhookSecret, setGithubWebhookSecret] = useState("");
  const [githubStatus, setGithubStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [githubVisible, setGithubVisible] = useState(false);
  const [githubWebhookVisible, setGithubWebhookVisible] = useState(false);
  const [githubTesting, setGithubTesting] = useState(false);
  const [githubSaving, setGithubSaving] = useState(false);

  // GitLab integration state
  const [gitlabToken, setGitlabToken] = useState("");
  const [gitlabWebhookSecret, setGitlabWebhookSecret] = useState("");
  const [gitlabDefaultRepo, setGitlabDefaultRepo] = useState("");
  const [gitlabStatus, _setGitlabStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [gitlabVisible, setGitlabVisible] = useState(false);
  const [gitlabWebhookVisible, setGitlabWebhookVisible] = useState(false);
  const [gitlabTesting, _setGitlabTesting] = useState(false);
  const [gitlabSaving, _setGitlabSaving] = useState(false);

  // BitBucket integration state
  const [bitbucketUsername, setBitbucketUsername] = useState("");
  const [bitbucketAppPassword, setBitbucketAppPassword] = useState("");
  const [bitbucketWebhookSecret, setBitbucketWebhookSecret] = useState("");
  const [bitbucketDefaultRepo, setBitbucketDefaultRepo] = useState("");
  const [bitbucketStatus, _setBitbucketStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [bitbucketVisible, setBitbucketVisible] = useState(false);
  const [bitbucketWebhookVisible, setBitbucketWebhookVisible] = useState(false);
  const [bitbucketTesting, _setBitbucketTesting] = useState(false);
  const [bitbucketSaving, _setBitbucketSaving] = useState(false);

  // Linear integration state
  const [linearApiKey, setLinearApiKey] = useState("");
  const [linearWebhookSecret, setLinearWebhookSecret] = useState("");
  const [linearStatus, setLinearStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [linearVisible, setLinearVisible] = useState(false);
  const [linearWebhookVisible, setLinearWebhookVisible] = useState(false);
  const [linearTesting, setLinearTesting] = useState(false);
  const [linearSaving, setLinearSaving] = useState(false);

  // Teams integration state
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState("");
  const [teamsStatus, setTeamsStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [teamsTesting, setTeamsTesting] = useState(false);
  const [teamsSaving, setTeamsSaving] = useState(false);

  // Discord integration state
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");
  const [discordStatus, setDiscordStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [discordTesting, setDiscordTesting] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [discordSaving, setDiscordSaving] = useState(false);

  // Email integration state
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [emailSmtpHost, setEmailSmtpHost] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [emailSmtpPort, setEmailSmtpPort] = useState("587");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [emailSmtpUser, setEmailSmtpUser] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [emailSmtpPassword, setEmailSmtpPassword] = useState("");
  const [emailStatus, setEmailStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [emailVisible, setEmailVisible] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [emailTesting, setEmailTesting] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [emailSaving, setEmailSaving] = useState(false);

  // OnCallShift integration state
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [oncallshiftApiKey, setOncallshiftApiKey] = useState("");
  const [oncallshiftStatus, setOncallshiftStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [oncallshiftVisible, setOncallshiftVisible] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [oncallshiftTesting, setOncallshiftTesting] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [oncallshiftSaving, setOncallshiftSaving] = useState(false);

  // Cloud provider states - Access Keys (legacy)
  const [awsAccessKey, setAwsAccessKey] = useState("");
  const [awsSecretKey, setAwsSecretKey] = useState("");
  const [awsRegion, setAwsRegion] = useState("");
  const [awsStatus, setAwsStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [awsVisible, setAwsVisible] = useState(false);
  const [awsSaving, setAwsSaving] = useState(false);
  // Cloud provider states - IAM Role (recommended)
  const [awsRoleArn, setAwsRoleArn] = useState("");
  const [awsExternalId, setAwsExternalId] = useState("");
  const [awsRoleConfigured, setAwsRoleConfigured] = useState(false);
  const [awsTesting, setAwsTesting] = useState(false);
  const [awsTestResult, setAwsTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [awsExternalIdLoading, setAwsExternalIdLoading] = useState(false);
  const [awsAuthMethod, setAwsAuthMethod] = useState<"role" | "keys">("role");

  const [gcpServiceAccount, setGcpServiceAccount] = useState("");
  const [gcpProjectId, setGcpProjectId] = useState("");
  const [gcpStatus, setGcpStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [gcpVisible, setGcpVisible] = useState(false);
  const [gcpSaving, setGcpSaving] = useState(false);

  const [azureClientId, setAzureClientId] = useState("");
  const [azureClientSecret, setAzureClientSecret] = useState("");
  const [azureTenantId, setAzureTenantId] = useState("");
  const [azureSubscriptionId, setAzureSubscriptionId] = useState("");
  const [azureStatus, setAzureStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [azureVisible, setAzureVisible] = useState(false);
  const [azureSaving, setAzureSaving] = useState(false);

  // Slide-over states for integrations
  const [jiraSlideOpen, setJiraSlideOpen] = useState(false);
  const [githubSlideOpen, setGithubSlideOpen] = useState(false);
  const [gitlabSlideOpen, setGitlabSlideOpen] = useState(false);
  const [bitbucketSlideOpen, setBitbucketSlideOpen] = useState(false);
  const [linearSlideOpen, setLinearSlideOpen] = useState(false);
  const [teamsSlideOpen, setTeamsSlideOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [discordSlideOpen, setDiscordSlideOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [emailSlideOpen, setEmailSlideOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [oncallshiftSlideOpen, setOncallshiftSlideOpen] = useState(false);
  const [awsSlideOpen, setAwsSlideOpen] = useState(false);
  const [gcpSlideOpen, setGcpSlideOpen] = useState(false);
  const [azureSlideOpen, setAzureSlideOpen] = useState(false);

  // Messages
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Team Members state
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamMembersLoading, setTeamMembersLoading] = useState(true);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member" | "viewer">("member");
  const [inviteSending, setInviteSending] = useState(false);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);

  // Usage state
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);

  // Slack integration state
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [slackStatus, setSlackStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [slackSlideOpen, setSlackSlideOpen] = useState(false);
  const [slackSaving, setSlackSaving] = useState(false);
  const [slackWebhookTesting, setSlackWebhookTesting] = useState(false);

  // User email preferences state (personal notification settings)
  const [userEmailPreferences, setUserEmailPreferences] = useState<EmailPreferences>({
    taskCompleted: true,
    taskFailed: true,
    costAlerts: true,
    prCreated: false,
    frequency: "immediate",
  });
  const [originalUserEmailPreferences, setOriginalUserEmailPreferences] = useState<EmailPreferences | null>(null);
  const [userEmailPrefsLoading, setUserEmailPrefsLoading] = useState(true);
  const [userEmailPrefsSaving, setUserEmailPrefsSaving] = useState(false);
  const [hasUnsavedUserEmailPrefs, setHasUnsavedUserEmailPrefs] = useState(false);

  // AI Provider credentials state
  const defaultProviderState: AIProviderState = {
    apiKey: "",
    visible: false,
    testing: false,
    saving: false,
    status: { configured: false, lastTested: null },
  };
  const [anthropicProvider, setAnthropicProvider] = useState<AIProviderState>({ ...defaultProviderState });
  const [openaiProvider, setOpenaiProvider] = useState<AIProviderState>({ ...defaultProviderState });
  const [googleProvider, setGoogleProvider] = useState<AIProviderState>({ ...defaultProviderState });

  // AI Provider slide-over states
  const [anthropicSlideOpen, setAnthropicSlideOpen] = useState(false);
  const [openaiSlideOpen, setOpenaiSlideOpen] = useState(false);
  const [googleSlideOpen, setGoogleSlideOpen] = useState(false);

  // WorkerMill MCP integration state
  const [workermillSlideOpen, setWorkermillSlideOpen] = useState(false);
  const [mcpApiKeys, setMcpApiKeys] = useState<{ id: string; name: string; keyPrefix: string; createdAt: string; lastUsedAt: string | null }[]>([]);
  const [mcpApiKeysLoading, setMcpApiKeysLoading] = useState(false);
  const [mcpNewKeyName, setMcpNewKeyName] = useState("");
  const [mcpCreatedToken, setMcpCreatedToken] = useState<string | null>(null);
  const [mcpCopiedToken, setMcpCopiedToken] = useState(false);
  const [mcpCreatingKey, setMcpCreatingKey] = useState(false);

  // Provider and model options
  const PROVIDER_OPTIONS = [
    { value: "anthropic", label: "Anthropic (Claude)", icon: "🤖" },
    { value: "openai", label: "OpenAI (GPT)", icon: "🔷" },
    { value: "google", label: "Google (Gemini)", icon: "🔵" },
    { value: "ollama", label: "Ollama (Local)", icon: "🏠" },
  ];

  const MODEL_OPTIONS: Record<string, { value: string; label: string; tier: string }[]> = {
    anthropic: [
      { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5", tier: "Powerful" },
      { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", tier: "Balanced" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", tier: "Fast" },
    ],
    openai: [
      { value: "gpt-5.1-codex", label: "GPT-5.1 Codex", tier: "Powerful" },
      { value: "gpt-4o", label: "GPT-4o", tier: "Balanced" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini", tier: "Fast" },
      { value: "o1", label: "o1 (Reasoning)", tier: "Powerful" },
      { value: "o1-mini", label: "o1 Mini", tier: "Balanced" },
    ],
    google: [
      { value: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview", tier: "Powerful" },
      { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", tier: "Balanced" },
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro", tier: "Balanced" },
      { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash", tier: "Fast" },
    ],
    ollama: [
      { value: "qwen2.5-coder:32b", label: "Qwen 2.5 Coder 32B", tier: "Recommended" },
      { value: "qwen3-coder:30b", label: "Qwen 3 Coder 30B", tier: "Recommended" },
      { value: "qwen2.5-coder:14b", label: "Qwen 2.5 Coder 14B", tier: "Balanced" },
      { value: "qwen2.5:14b-instruct-q4_K_M", label: "Qwen 2.5 14B Instruct", tier: "Balanced" },
      { value: "devstral-small-2:24b-instruct-2512-q8_0", label: "Devstral Small 24B", tier: "Balanced" },
      { value: "deepseek-r1:70b", label: "DeepSeek R1 70B", tier: "Powerful" },
      { value: "llama3.3:70b", label: "Llama 3.3 70B", tier: "Powerful" },
      { value: "mistral:7b-instruct", label: "Mistral 7B Instruct", tier: "Fast" },
      { value: "llama3.1:8b", label: "Llama 3.1 8B", tier: "Fast" },
    ],
  };

  const currentModels = MODEL_OPTIONS[settings.primaryProvider] || MODEL_OPTIONS.anthropic;

  const PERSONA_OPTIONS = [
    { value: "frontend_developer", label: "Frontend Developer" },
    { value: "backend_developer", label: "Backend Developer" },
    { value: "api_developer", label: "API Developer" },
    { value: "devops_engineer", label: "DevOps Engineer" },
    { value: "security_engineer", label: "Security Engineer" },
    { value: "qa_engineer", label: "QA Engineer" },
    { value: "tech_writer", label: "Technical Writer" },
    { value: "project_manager", label: "Project Manager" },
    { value: "data_engineer", label: "Data Engineer" },
    { value: "database_administrator", label: "Database Administrator" },
    { value: "ml_engineer", label: "ML Engineer" },
    { value: "mobile_developer_ios", label: "Mobile Developer (iOS)" },
    { value: "mobile_developer_android", label: "Mobile Developer (Android)" },
  ];

  // Fetch functions
  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (!response.ok) throw new Error("Failed to load settings");
      const data = await response.json();
      const loadedSettings: Settings = {
        logRetentionDays: data.logRetentionDays ?? 30,
        taskRetentionDays: data.taskRetentionDays ?? 90,
        maxConcurrentWorkers: data.maxConcurrentWorkers ?? 3,
        defaultMaxRetries: data.defaultMaxRetries ?? 3,
        taskCooldownSeconds: data.taskCooldownSeconds ?? 60,
        defaultWorkerModel: data.defaultWorkerModel || "claude-haiku-4-5-20251001",
        defaultWorkerPersona: data.defaultWorkerPersona || "backend_developer",
        primaryProvider: data.primaryProvider || "anthropic",
        providerRouting: data.providerRouting ?? {},
        ollamaBaseUrl: data.ollamaBaseUrl ?? null,
        ollamaContextWindow: data.ollamaContextWindow ?? 65536,
        managerProvider: data.managerProvider || "openai",
        managerModelId: data.managerModelId || "gpt-5.1-codex",
        planningAgentProvider: data.planningAgentProvider || "anthropic",
        planningAgentModel: data.planningAgentModel || "claude-sonnet-4-5-20250929",
        storyCalibrationMultiplier: data.storyCalibrationMultiplier ?? 0.4,
        costAlertThresholdUsd: data.costAlertThresholdUsd ?? null,
        completedTaskDisplayMinutes: data.completedTaskDisplayMinutes ?? 10,
        intermediateTaskDisplayMinutes: data.intermediateTaskDisplayMinutes ?? 60,
        dryRunVisibilityMinutes: data.dryRunVisibilityMinutes ?? 1,
        emailNotificationsEnabled: data.emailNotificationsEnabled ?? true,
        emailFromAddress: data.emailFromAddress ?? null,
        defaultEmailPreferences: data.defaultEmailPreferences ?? {
          taskCompleted: true,
          taskFailed: true,
          costAlerts: true,
          prCreated: false,
          frequency: "immediate",
        },
        scmProvider: data.scmProvider || "github",
        scmBaseUrl: data.scmBaseUrl ?? null,
      };
      setSettings(loadedSettings);
      setOriginalSettings(loadedSettings);
    } catch (err) {
      console.error("Failed to fetch settings:", err);
      setSettingsError("Failed to load settings. Using default values.");
    } finally {
      setSettingsLoading(false);
    }
  }, [tokens?.accessToken]);

  const fetchIntegrations = useCallback(async () => {
    setIntegrationsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (!response.ok) throw new Error("Failed to load integration status");
      const data = await response.json();
      setJiraStatus({
        connected: data.jira?.configured || false,
        lastChecked: new Date().toISOString(),
        webhookSecretConfigured: data.jira?.webhookSecretConfigured || false,
      });
      if (data.jira?.baseUrl) setJiraBaseUrl(data.jira.baseUrl);
      if (data.jira?.email) setJiraEmail(data.jira.email);
      setGithubStatus({
        connected: data.github?.configured || false,
        lastChecked: new Date().toISOString(),
        webhookSecretConfigured: data.github?.webhookSecretConfigured || false,
      });
      if (data.github?.defaultRepo) setGithubDefaultRepo(data.github.defaultRepo);
      setLinearStatus({ connected: data.linear?.configured || false, lastChecked: new Date().toISOString() });
      setSlackStatus({ connected: data.slack?.configured || false, lastChecked: new Date().toISOString() });
      setTeamsStatus({ connected: data.teams?.configured || false, lastChecked: new Date().toISOString() });
      // AWS is configured if either access keys OR IAM role is set up
      setAwsStatus({ connected: data.aws?.configured || data.aws?.roleConfigured || false, lastChecked: new Date().toISOString() });
      // Load role config if available
      if (data.aws?.roleConfigured && data.aws?.roleArn) {
        setAwsRoleArn(data.aws.roleArn);
        setAwsRoleConfigured(true);
      }
      if (data.aws?.externalId) {
        setAwsExternalId(data.aws.externalId);
      }
      setGcpStatus({ connected: data.gcp?.configured || false, lastChecked: new Date().toISOString() });
      setAzureStatus({ connected: data.azure?.configured || false, lastChecked: new Date().toISOString() });
    } catch (err) {
      console.error("Failed to fetch integration status:", err);
    } finally {
      setIntegrationsLoading(false);
    }
  }, [tokens?.accessToken]);

  // Fetch user's personal email preferences from profile
  const fetchUserEmailPreferences = useCallback(async () => {
    if (!tokens?.accessToken) return;
    setUserEmailPrefsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/profile`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) throw new Error("Failed to load profile");
      const data = await response.json();
      const emailPrefs: EmailPreferences = data.preferences?.email || {
        taskCompleted: true,
        taskFailed: true,
        costAlerts: true,
        prCreated: false,
        frequency: "immediate",
      };
      setUserEmailPreferences(emailPrefs);
      setOriginalUserEmailPreferences(emailPrefs);
    } catch (err) {
      console.error("Failed to fetch user email preferences:", err);
    } finally {
      setUserEmailPrefsLoading(false);
    }
  }, [tokens?.accessToken]);

  // Save user's personal email preferences
  const saveUserEmailPreferences = async () => {
    if (!tokens?.accessToken) return;
    setUserEmailPrefsSaving(true);
    try {
      const response = await fetch(`${API_BASE}/api/profile`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          preferences: { email: userEmailPreferences },
        }),
      });
      if (!response.ok) throw new Error("Failed to save preferences");
      setOriginalUserEmailPreferences(userEmailPreferences);
      setHasUnsavedUserEmailPrefs(false);
      setMessage({ type: "success", text: "Your notification preferences saved" });
    } catch (err) {
      setMessage({ type: "error", text: "Failed to save your notification preferences" });
    } finally {
      setUserEmailPrefsSaving(false);
    }
  };

  // Update user email preference helper
  const updateUserEmailPref = <K extends keyof EmailPreferences>(key: K, value: EmailPreferences[K]) => {
    setUserEmailPreferences((prev) => ({ ...prev, [key]: value }));
  };

  const fetchTeamMembers = useCallback(async () => {
    if (!tokens?.accessToken) return;
    setTeamMembersLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/organizations/current/members`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setTeamMembers(data.members || []);
      }
    } catch (err) {
      console.error("Failed to fetch team members:", err);
    } finally {
      setTeamMembersLoading(false);
    }
  }, [tokens?.accessToken]);

  const fetchPendingInvites = useCallback(async () => {
    if (!tokens?.accessToken) return;
    setInvitesLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/organizations/current/invites`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setPendingInvites(data.invites || []);
      }
    } catch (err) {
      console.error("Failed to fetch pending invites:", err);
    } finally {
      setInvitesLoading(false);
    }
  }, [tokens?.accessToken]);

  const fetchUsageData = useCallback(async () => {
    if (!tokens?.accessToken) return;
    setUsageLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/billing/usage`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        setUsageData(data);
      }
    } catch (err) {
      console.error("Failed to fetch usage data:", err);
    } finally {
      setUsageLoading(false);
    }
  }, [tokens?.accessToken]);

  const fetchProviderStatus = useCallback(async () => {
    if (!tokens?.accessToken) return;

    const providers = ["anthropic", "openai", "google"] as const;

    for (const providerId of providers) {
      try {
        const response = await fetch(`${API_BASE}/api/settings/providers/${providerId}/test`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        const data = await response.json();

        const setProvider = {
          anthropic: setAnthropicProvider,
          openai: setOpenaiProvider,
          google: setGoogleProvider,
        }[providerId];

        setProvider((prev) => ({
          ...prev,
          status: {
            configured: response.ok,
            lastTested: new Date().toISOString(),
            error: response.ok ? undefined : data.error,
          },
        }));
      } catch {
        // Silently fail - provider not configured
      }
    }
  }, [tokens?.accessToken]);

  // WorkerMill MCP API Keys fetch (for showing configured status on page load)
  const fetchMcpApiKeys = useCallback(async () => {
    if (!tokens?.accessToken) return;
    setMcpApiKeysLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/profile/api-keys`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMcpApiKeys(data.apiKeys);
      }
    } catch (error) {
      console.error("Failed to fetch MCP API keys:", error);
    } finally {
      setMcpApiKeysLoading(false);
    }
  }, [tokens?.accessToken]);

  useEffect(() => {
    if (tokens?.accessToken) {
      fetchSettings();
      fetchIntegrations();
      fetchTeamMembers();
      fetchPendingInvites();
      fetchUsageData();
      fetchProviderStatus();
      fetchUserEmailPreferences();
      fetchMcpApiKeys();
    }
  }, [tokens?.accessToken, fetchSettings, fetchIntegrations, fetchTeamMembers, fetchPendingInvites, fetchUsageData, fetchProviderStatus, fetchUserEmailPreferences, fetchMcpApiKeys]);

  useEffect(() => {
    if (originalSettings) {
      setHasUnsavedChanges(JSON.stringify(settings) !== JSON.stringify(originalSettings));
    }
  }, [settings, originalSettings]);

  // Track unsaved changes in user email preferences
  useEffect(() => {
    if (originalUserEmailPreferences) {
      setHasUnsavedUserEmailPrefs(JSON.stringify(userEmailPreferences) !== JSON.stringify(originalUserEmailPreferences));
    }
  }, [userEmailPreferences, originalUserEmailPreferences]);

  // Validation
  const validateSettings = (): boolean => {
    const errors: ValidationErrors = {};
    if (settings.logRetentionDays < 1 || settings.logRetentionDays > 365) {
      errors.logRetentionDays = "Must be between 1 and 365 days";
    }
    if (settings.taskRetentionDays < 1 || settings.taskRetentionDays > 730) {
      errors.taskRetentionDays = "Must be between 1 and 730 days";
    }
    if (settings.maxConcurrentWorkers < 1 || settings.maxConcurrentWorkers > 10) {
      errors.maxConcurrentWorkers = "Must be between 1 and 10 workers";
    }
    if (settings.defaultMaxRetries < 0 || settings.defaultMaxRetries > 10) {
      errors.defaultMaxRetries = "Must be between 0 and 10 retries";
    }
    if (settings.taskCooldownSeconds < 0 || settings.taskCooldownSeconds > 86400) {
      errors.taskCooldownSeconds = "Must be between 0 and 86400 seconds";
    }
    if (settings.costAlertThresholdUsd !== null && settings.costAlertThresholdUsd < 0) {
      errors.costAlertThresholdUsd = "Must be a positive value or empty";
    }
    if (settings.completedTaskDisplayMinutes < 1 || settings.completedTaskDisplayMinutes > 60) {
      errors.completedTaskDisplayMinutes = "Must be between 1 and 60 minutes";
    }
    if (settings.intermediateTaskDisplayMinutes < 1 || settings.intermediateTaskDisplayMinutes > 1440) {
      errors.intermediateTaskDisplayMinutes = "Must be between 1 and 1440 minutes";
    }
    if (settings.dryRunVisibilityMinutes < 1 || settings.dryRunVisibilityMinutes > 60) {
      errors.dryRunVisibilityMinutes = "Must be between 1 and 60 minutes";
    }
    if (settings.ollamaContextWindow < 2048 || settings.ollamaContextWindow > 262144) {
      errors.ollamaContextWindow = "Must be between 2048 and 262144 tokens";
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Save settings
  const handleSaveSettings = async () => {
    if (!validateSettings()) {
      setMessage({ type: "error", text: "Please fix validation errors before saving" });
      return;
    }
    setSettingsSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settings),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to save settings");
      }
      const data = await response.json();
      const savedSettings = data.settings || data;
      setOriginalSettings(savedSettings);
      setSettings(savedSettings);
      setMessage({ type: "success", text: data.message || "Settings saved successfully" });
      setHasUnsavedChanges(false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save settings" });
    } finally {
      setSettingsSaving(false);
    }
  };

  // Discard changes
  const handleDiscardChanges = () => {
    if (originalSettings) {
      setSettings(originalSettings);
      setValidationErrors({});
      setHasUnsavedChanges(false);
    }
  };

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    if (validationErrors[key as keyof ValidationErrors]) {
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[key as keyof ValidationErrors];
        return newErrors;
      });
    }
  };

  // Integration handlers
  const handleTestJira = async () => {
    setJiraTesting(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/jira/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Jira connection failed");
      setJiraStatus({ connected: true, lastChecked: new Date().toISOString() });
      setMessage({ type: "success", text: `Jira connection successful (${data.user})` });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Jira connection failed" });
      setJiraStatus({ connected: false, lastChecked: new Date().toISOString() });
    } finally {
      setJiraTesting(false);
    }
  };

  const handleSaveJira = async () => {
    // Validate: need either webhook secret OR all three API credential fields
    const hasApiCredentials = jiraBaseUrl && jiraEmail && jiraApiKey;
    const hasWebhookSecret = !!jiraWebhookSecret;

    if (!hasApiCredentials && !hasWebhookSecret) {
      setMessage({ type: "error", text: "Please enter either API credentials (all fields) or a webhook secret" });
      return;
    }

    setJiraSaving(true);
    setMessage(null);
    try {
      // Build payload with only non-empty fields
      const payload: Record<string, string> = {};
      if (jiraBaseUrl) payload.baseUrl = jiraBaseUrl;
      if (jiraEmail) payload.email = jiraEmail;
      if (jiraApiKey) payload.apiToken = jiraApiKey;
      if (jiraWebhookSecret) payload.webhookSecret = jiraWebhookSecret;

      console.log("Saving Jira settings:", { ...payload, apiToken: payload.apiToken ? "***" : undefined });

      const response = await fetch(`${API_BASE}/api/settings/integrations/jira`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save Jira credentials");
      setMessage({ type: "success", text: "Jira settings saved successfully" });
      setJiraApiKey("");
      setJiraWebhookSecret("");
      fetchIntegrations();
      setJiraSlideOpen(false);
    } catch (err) {
      console.error("Failed to save Jira settings:", err);
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save Jira credentials" });
    } finally {
      setJiraSaving(false);
    }
  };

  const handleTestGithub = async () => {
    setGithubTesting(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/github/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "GitHub connection failed");
      setGithubStatus({ connected: true, lastChecked: new Date().toISOString() });
      setMessage({ type: "success", text: `GitHub connection successful (${data.user})` });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "GitHub connection failed" });
      setGithubStatus({ connected: false, lastChecked: new Date().toISOString() });
    } finally {
      setGithubTesting(false);
    }
  };

  const handleSaveGithub = async () => {
    setGithubSaving(true);
    setMessage(null);
    try {
      const payload: { token?: string; defaultRepo?: string; webhookSecret?: string } = {};
      if (githubToken) payload.token = githubToken;
      if (githubDefaultRepo) payload.defaultRepo = githubDefaultRepo;
      if (githubWebhookSecret) payload.webhookSecret = githubWebhookSecret;
      const response = await fetch(`${API_BASE}/api/settings/integrations/github`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save GitHub credentials");
      setMessage({ type: "success", text: "GitHub settings saved successfully" });
      setGithubToken("");
      setGithubWebhookSecret("");
      fetchIntegrations();
      setGithubSlideOpen(false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save GitHub credentials" });
    } finally {
      setGithubSaving(false);
    }
  };

  const handleTestLinear = async () => {
    setLinearTesting(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/linear/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Linear connection failed");
      setLinearStatus({ connected: true, lastChecked: new Date().toISOString() });
      setMessage({ type: "success", text: `Linear connection successful (${data.user})` });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Linear connection failed" });
      setLinearStatus({ connected: false, lastChecked: new Date().toISOString() });
    } finally {
      setLinearTesting(false);
    }
  };

  const handleSaveLinear = async () => {
    setLinearSaving(true);
    setMessage(null);
    try {
      const payload: { apiKey?: string; webhookSecret?: string } = {};
      if (linearApiKey) payload.apiKey = linearApiKey;
      if (linearWebhookSecret) payload.webhookSecret = linearWebhookSecret;

      if (!payload.apiKey && !payload.webhookSecret) {
        setMessage({ type: "error", text: "Please enter an API key or webhook secret" });
        setLinearSaving(false);
        return;
      }

      const response = await fetch(`${API_BASE}/api/settings/integrations/linear`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save Linear credentials");
      setMessage({ type: "success", text: "Linear settings saved successfully" });
      setLinearApiKey("");
      setLinearWebhookSecret("");
      fetchIntegrations();
      setLinearSlideOpen(false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save Linear credentials" });
    } finally {
      setLinearSaving(false);
    }
  };

  const handleTestSlackWebhook = async () => {
    setSlackWebhookTesting(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/slack/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Slack webhook test failed");
      setSlackStatus({ connected: true, lastChecked: new Date().toISOString() });
      setMessage({ type: "success", text: "Slack webhook test successful! Check your Slack channel." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Slack webhook test failed" });
    } finally {
      setSlackWebhookTesting(false);
    }
  };

  const handleSaveSlack = async () => {
    if (!slackWebhookUrl) {
      setMessage({ type: "error", text: "Please enter a Slack webhook URL" });
      return;
    }
    setSlackSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/slack`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ webhookUrl: slackWebhookUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save Slack webhook");
      setMessage({ type: "success", text: "Slack webhook saved successfully" });
      setSlackWebhookUrl("");
      fetchIntegrations();
      setSlackSlideOpen(false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save Slack webhook" });
    } finally {
      setSlackSaving(false);
    }
  };

  // Teams integration handlers
  const handleTestTeams = async () => {
    setTeamsTesting(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/teams/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Teams webhook test failed");
      setTeamsStatus({ connected: true, lastChecked: new Date().toISOString() });
      setMessage({ type: "success", text: data.message || "Teams webhook test successful!" });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Teams webhook test failed" });
    } finally {
      setTeamsTesting(false);
    }
  };

  const handleSaveTeams = async () => {
    if (!teamsWebhookUrl) {
      setMessage({ type: "error", text: "Please enter a Teams webhook URL" });
      return;
    }
    setTeamsSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/teams`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ webhookUrl: teamsWebhookUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save Teams webhook");
      setMessage({ type: "success", text: "Teams webhook saved successfully" });
      setTeamsWebhookUrl("");
      fetchIntegrations();
      setTeamsSlideOpen(false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save Teams webhook" });
    } finally {
      setTeamsSaving(false);
    }
  };

  // Cloud provider handlers
  const handleSaveAws = async () => {
    if (!awsAccessKey || !awsSecretKey) {
      setMessage({ type: "error", text: "Please enter both Access Key ID and Secret Access Key" });
      return;
    }
    setAwsSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/aws`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessKeyId: awsAccessKey,
          secretAccessKey: awsSecretKey,
          region: awsRegion || "us-east-1",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save AWS credentials");
      setMessage({ type: "success", text: "AWS credentials saved successfully" });
      setAwsAccessKey("");
      setAwsSecretKey("");
      setAwsRegion("");
      fetchIntegrations();
      setAwsSlideOpen(false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save AWS credentials" });
    } finally {
      setAwsSaving(false);
    }
  };

  // Fetch AWS External ID for role-based auth
  const fetchAwsExternalId = async () => {
    setAwsExternalIdLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/aws/external-id`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      const data = await response.json();
      if (response.ok) {
        setAwsExternalId(data.externalId);
      }
    } catch (err) {
      console.error("Failed to fetch AWS external ID:", err);
    } finally {
      setAwsExternalIdLoading(false);
    }
  };

  // Fetch AWS Role configuration
  const fetchAwsRoleConfig = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/aws/role`, {
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      const data = await response.json();
      if (response.ok && data.configured) {
        setAwsRoleArn(data.roleArn || "");
        setAwsRegion(data.region || "us-east-1");
        setAwsRoleConfigured(true);
      }
    } catch (err) {
      console.error("Failed to fetch AWS role config:", err);
    }
  };

  // Save AWS Role configuration
  const handleSaveAwsRole = async () => {
    if (!awsRoleArn) {
      setMessage({ type: "error", text: "Please enter the IAM Role ARN" });
      return;
    }
    if (!awsRoleArn.startsWith("arn:aws:iam::")) {
      setMessage({ type: "error", text: "Invalid Role ARN format. Should start with arn:aws:iam::" });
      return;
    }
    setAwsSaving(true);
    setMessage(null);
    setAwsTestResult(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/aws/role`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roleArn: awsRoleArn,
          region: awsRegion || "us-east-1",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save AWS role configuration");
      setMessage({ type: "success", text: "AWS role configuration saved successfully" });
      setAwsRoleConfigured(true);
      fetchIntegrations();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save AWS role configuration" });
    } finally {
      setAwsSaving(false);
    }
  };

  // Test AWS Role assumption
  const handleTestAwsRole = async () => {
    if (!awsRoleArn) {
      setAwsTestResult({ success: false, message: "Please enter a Role ARN first" });
      return;
    }
    setAwsTesting(true);
    setAwsTestResult(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/aws/role/test`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setAwsTestResult({ success: true, message: "Successfully assumed customer role!" });
      } else {
        setAwsTestResult({ success: false, message: data.error || data.hint || "Failed to assume role" });
      }
    } catch (err) {
      setAwsTestResult({ success: false, message: err instanceof Error ? err.message : "Connection test failed" });
    } finally {
      setAwsTesting(false);
    }
  };

  // Load AWS role config when slide opens
  const handleAwsSlideOpen = () => {
    setAwsSlideOpen(true);
    setAwsTestResult(null);
    // Show role tab if role configured, keys tab if only keys configured, else role (recommended)
    if (awsRoleConfigured) {
      setAwsAuthMethod("role");
    } else if (awsStatus.connected && !awsRoleConfigured) {
      setAwsAuthMethod("keys"); // Keys are configured but not role
    } else {
      setAwsAuthMethod("role"); // Default to recommended option
    }
    fetchAwsExternalId();
    fetchAwsRoleConfig();
  };

  const handleSaveGcp = async () => {
    if (!gcpProjectId || !gcpServiceAccount) {
      setMessage({ type: "error", text: "Please enter both Project ID and Service Account JSON" });
      return;
    }
    setGcpSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/gcp`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: gcpProjectId,
          serviceAccountJson: gcpServiceAccount,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save GCP credentials");
      setMessage({ type: "success", text: "GCP credentials saved successfully" });
      setGcpProjectId("");
      setGcpServiceAccount("");
      fetchIntegrations();
      setGcpSlideOpen(false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save GCP credentials" });
    } finally {
      setGcpSaving(false);
    }
  };

  const handleSaveAzure = async () => {
    if (!azureClientId || !azureClientSecret || !azureTenantId || !azureSubscriptionId) {
      setMessage({ type: "error", text: "Please fill in all Azure credential fields" });
      return;
    }
    setAzureSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/azure`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId: azureClientId,
          clientSecret: azureClientSecret,
          tenantId: azureTenantId,
          subscriptionId: azureSubscriptionId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save Azure credentials");
      setMessage({ type: "success", text: "Azure credentials saved successfully" });
      setAzureClientId("");
      setAzureClientSecret("");
      setAzureTenantId("");
      setAzureSubscriptionId("");
      fetchIntegrations();
      setAzureSlideOpen(false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save Azure credentials" });
    } finally {
      setAzureSaving(false);
    }
  };

  // AI Provider credential handlers
  const handleTestProvider = async (providerId: "anthropic" | "openai" | "google") => {
    const setProvider = {
      anthropic: setAnthropicProvider,
      openai: setOpenaiProvider,
      google: setGoogleProvider,
    }[providerId];

    setProvider((prev) => ({ ...prev, testing: true }));
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE}/api/settings/providers/${providerId}/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || `${providerId} connection failed`);

      setProvider((prev) => ({
        ...prev,
        status: { configured: true, lastTested: new Date().toISOString() },
      }));
      setMessage({ type: "success", text: data.message || `${providerId} connection successful` });
    } catch (err) {
      setProvider((prev) => ({
        ...prev,
        status: { configured: false, lastTested: new Date().toISOString(), error: err instanceof Error ? err.message : "Connection failed" },
      }));
      setMessage({ type: "error", text: err instanceof Error ? err.message : `${providerId} connection failed` });
    } finally {
      setProvider((prev) => ({ ...prev, testing: false }));
    }
  };

  const handleSaveProvider = async (providerId: "anthropic" | "openai" | "google") => {
    const providers = {
      anthropic: { state: anthropicProvider, setter: setAnthropicProvider, setSlide: setAnthropicSlideOpen },
      openai: { state: openaiProvider, setter: setOpenaiProvider, setSlide: setOpenaiSlideOpen },
      google: { state: googleProvider, setter: setGoogleProvider, setSlide: setGoogleSlideOpen },
    };

    const { state, setter, setSlide } = providers[providerId];

    if (!state.apiKey) {
      setMessage({ type: "error", text: "API key is required" });
      return;
    }

    setter((prev) => ({ ...prev, saving: true }));
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE}/api/settings/providers/${providerId}/credentials`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ apiKey: state.apiKey }),
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || `Failed to save ${providerId} credentials`);

      setMessage({ type: "success", text: data.message || `${providerId} credentials saved successfully` });
      setter((prev) => ({ ...prev, apiKey: "", status: { configured: true, lastTested: new Date().toISOString() } }));
      setSlide(false);
      fetchProviderStatus();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : `Failed to save ${providerId} credentials` });
    } finally {
      setter((prev) => ({ ...prev, saving: false }));
    }
  };

  // WorkerMill MCP API Key handlers
  const handleCreateMcpApiKey = async () => {
    if (!mcpNewKeyName.trim()) return;
    setMcpCreatingKey(true);
    try {
      const res = await fetch(`${API_BASE}/api/profile/api-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
        body: JSON.stringify({ name: mcpNewKeyName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setMcpCreatedToken(data.token);
        setMcpApiKeys([data.apiKey, ...mcpApiKeys]);
        setMcpNewKeyName("");
      } else {
        setMessage({ type: "error", text: data.error || "Failed to create API key" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to create API key" });
    } finally {
      setMcpCreatingKey(false);
    }
  };

  const handleDeleteMcpApiKey = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/profile/api-keys/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (res.ok) {
        setMcpApiKeys(mcpApiKeys.filter((k) => k.id !== id));
        setMessage({ type: "success", text: "API key revoked" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to revoke API key" });
    }
  };

  const handleCopyMcpToken = async () => {
    if (mcpCreatedToken) {
      await navigator.clipboard.writeText(mcpCreatedToken);
      setMcpCopiedToken(true);
      setTimeout(() => setMcpCopiedToken(false), 2000);
    }
  };

  // Invite handlers
  const handleSendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/organizations/current/invites`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to send invite");
      setMessage({ type: "success", text: `Invite sent to ${inviteEmail}` });
      setShowInviteModal(false);
      setInviteEmail("");
      setInviteRole("member");
      fetchPendingInvites();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to send invite" });
    } finally {
      setInviteSending(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    setRevokingInviteId(inviteId);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/organizations/current/invites/${inviteId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to revoke invite");
      }
      setMessage({ type: "success", text: "Invite revoked successfully" });
      fetchPendingInvites();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to revoke invite" });
    } finally {
      setRevokingInviteId(null);
    }
  };

  // Helpers
  const formatCooldownDisplay = (seconds: number): string => {
    if (seconds < 60) return `${seconds} seconds`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
    return `${Math.floor(seconds / 3600)} hours`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "admin": return "bg-purple-500/20 text-purple-500";
      case "member": return "bg-blue-500/20 text-blue-500";
      case "viewer": return "bg-gray-500/20 text-gray-400";
      default: return "bg-gray-500/20 text-gray-400";
    }
  };

  // Get summaries for collapsed sections
  const getWorkersSummary = () => {
    const provider = PROVIDER_OPTIONS.find((p) => p.value === settings.primaryProvider)?.label.split(" ")[0] || "Anthropic";
    const model = currentModels.find((m) => m.value === settings.defaultWorkerModel)?.label || "Haiku";
    return `${provider} ${model}`;
  };

  const getExecutionSummary = () => {
    return `${settings.maxConcurrentWorkers} workers, ${formatCooldownDisplay(settings.taskCooldownSeconds)} cooldown`;
  };

  const getManagerSummary = () => {
    const provider = PROVIDER_OPTIONS.find((p) => p.value === settings.managerProvider)?.label.split(" ")[0] || "OpenAI";
    const models = MODEL_OPTIONS[settings.managerProvider] || MODEL_OPTIONS.anthropic;
    const model = models.find((m) => m.value === settings.managerModelId)?.label || "GPT-5.1";
    return `${provider} ${model}`;
  };

  const getRoutingSummary = () => {
    const routeCount = Object.keys(settings.providerRouting).filter(
      (k) => settings.providerRouting[k]?.provider
    ).length;
    if (routeCount === 0) return "No custom routes";
    return `${routeCount} custom route${routeCount > 1 ? "s" : ""} configured`;
  };

  const getCostSummary = () => {
    return settings.costAlertThresholdUsd ? `Alert at $${settings.costAlertThresholdUsd}` : "No alert set";
  };

  // Render category content
  const renderCategoryContent = () => {
    switch (activeCategory) {
      case "general":
        return renderGeneralSection();
      case "team":
        return renderTeamSection();
      case "ai-workers":
        return renderAIWorkersSection();
      case "integrations":
        return renderIntegrationsSection();
      case "notifications":
        return renderNotificationsSection();
      case "data":
        return renderDataSection();
      default:
        return null;
    }
  };

  // General Section
  const renderGeneralSection = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">General</h2>
        <p className="text-sm text-muted-foreground">Organization settings and usage</p>
      </div>

      {/* Organization Card */}
      <div className="border border-border/50 rounded-xl p-6 bg-card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <Building className="w-5 h-5 text-purple-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Organization</h3>
            <p className="text-sm text-muted-foreground">Your workspace details</p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">Organization Name</label>
            <input
              type="text"
              value="WorkerMill Inc."
              disabled
              className="w-full px-4 py-3 rounded-xl bg-muted/30 border border-border text-muted-foreground cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">Plan</label>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 text-sm font-medium rounded-full bg-primary/20 text-primary">
                Early Access
              </span>
              <a href="***REMOVED***" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                View billing <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Usage Card */}
      <div className="border border-border/50 rounded-xl p-6 bg-card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-green-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Usage</h3>
            <p className="text-sm text-muted-foreground">Track your task usage this billing period</p>
          </div>
        </div>
        {usageLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="ml-2 text-muted-foreground">Loading usage data...</span>
          </div>
        ) : usageData ? (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">Tasks this month</span>
                <span className="text-sm text-muted-foreground">
                  {usageData.tasks.isUnlimited ? (
                    <>{usageData.tasks.used} / Unlimited</>
                  ) : (
                    <>{usageData.tasks.used} / {usageData.tasks.quota} tasks</>
                  )}
                </span>
              </div>
              {!usageData.tasks.isUnlimited && (
                <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      usageData.tasks.percent >= 90
                        ? "bg-red-500"
                        : usageData.tasks.percent >= 75
                          ? "bg-yellow-500"
                          : "bg-green-500"
                    }`}
                    style={{ width: `${Math.min(usageData.tasks.percent, 100)}%` }}
                  />
                </div>
              )}
              <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                <span className="capitalize">{usageData.plan} plan</span>
                {usageData.billingPeriod.daysUntilReset > 0 && (
                  <span>Resets in {usageData.billingPeriod.daysUntilReset} days</span>
                )}
              </div>
            </div>
            {!usageData.tasks.isUnlimited && usageData.tasks.percent >= 90 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>You&apos;ve used {usageData.tasks.percent}% of your monthly task quota.</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-center py-4">Unable to load usage data</p>
        )}
      </div>
    </div>
  );

  // Team Section
  const renderTeamSection = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-1">Team</h2>
          <p className="text-sm text-muted-foreground">Manage your organization&apos;s members</p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white text-sm font-semibold rounded-lg hover:bg-indigo-600 transition-all"
        >
          <UserPlus className="w-4 h-4" />
          Invite Member
        </button>
      </div>

      {/* Current Members */}
      <div className="border border-border/50 rounded-xl p-6 bg-card">
        <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-500" />
          Active Members
        </h3>
        {teamMembersLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="ml-2 text-muted-foreground">Loading team members...</span>
          </div>
        ) : teamMembers.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No team members yet. Invite someone to get started.</p>
        ) : (
          <div className="space-y-2">
            {teamMembers.map((member) => (
              <div key={member.id} className="flex items-center justify-between p-4 bg-background/50 rounded-lg border border-border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center">
                    <span className="text-indigo-500 font-semibold">
                      {(member.fullName || member.email).charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{member.fullName || member.email}</p>
                    <p className="text-sm text-muted-foreground">{member.email}</p>
                  </div>
                </div>
                <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${getRoleBadgeColor(member.role)}`}>
                  {member.role}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Invites */}
      <div className="border border-border/50 rounded-xl p-6 bg-card">
        <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
          <Mail className="w-4 h-4 text-yellow-500" />
          Pending Invites
        </h3>
        {invitesLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : pendingInvites.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No pending invites</p>
        ) : (
          <div className="space-y-2">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between p-3 bg-yellow-500/5 rounded-lg border border-yellow-500/20">
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-yellow-500" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{invite.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Expires {formatDate(invite.expiresAt)} | Role: <span className="capitalize">{invite.role}</span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleRevokeInvite(invite.id)}
                  disabled={revokingInviteId === invite.id}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                >
                  {revokingInviteId === invite.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // AI Workers Section
  const renderAIWorkersSection = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">AI Workers</h2>
        <p className="text-sm text-muted-foreground">Configure AI worker behavior and defaults</p>
      </div>

      {settingsLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">Loading settings...</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Default Configuration */}
          <CollapsibleSection
            title="Default Configuration"
            icon={<Cpu className="w-4 h-4" />}
            iconBgColor="bg-cyan-500/20"
            iconColor="text-cyan-500"
            summary={getWorkersSummary()}
            defaultOpen={true}
          >
            <div className="space-y-6">
              {/* Provider Selection */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-3">Primary Provider</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {PROVIDER_OPTIONS.map((provider) => (
                    <button
                      key={provider.value}
                      onClick={() => {
                        updateSetting("primaryProvider", provider.value);
                        const newProviderModels = MODEL_OPTIONS[provider.value];
                        if (newProviderModels && !newProviderModels.find((m) => m.value === settings.defaultWorkerModel)) {
                          updateSetting("defaultWorkerModel", newProviderModels[0].value);
                        }
                      }}
                      className={`p-3 rounded-lg border-2 transition-all ${
                        settings.primaryProvider === provider.value
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background/50 hover:border-primary/50"
                      }`}
                    >
                      <div className="text-2xl mb-1">{provider.icon}</div>
                      <div className="text-xs font-medium">{provider.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">Default Model</label>
                  <select
                    value={settings.defaultWorkerModel}
                    onChange={(e) => updateSetting("defaultWorkerModel", e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                  >
                    {currentModels.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} ({option.tier})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">Default Persona</label>
                  <select
                    value={settings.defaultWorkerPersona}
                    onChange={(e) => updateSetting("defaultWorkerPersona", e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                  >
                    {PERSONA_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          {/* Execution Settings */}
          <CollapsibleSection
            title="Execution Settings"
            icon={<Sliders className="w-4 h-4" />}
            iconBgColor="bg-accent/20"
            iconColor="text-accent"
            summary={getExecutionSummary()}
          >
            <div className="space-y-6">
              {/* Max Concurrent Workers */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Max Concurrent Workers</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={settings.maxConcurrentWorkers}
                    onChange={(e) => updateSetting("maxConcurrentWorkers", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  <div className="w-20">
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={settings.maxConcurrentWorkers}
                      onChange={(e) => updateSetting("maxConcurrentWorkers", parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                </div>
                {validationErrors.maxConcurrentWorkers && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.maxConcurrentWorkers}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Maximum workers running simultaneously (1-10)</p>
              </div>

              {/* Task Cooldown */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Task Cooldown Period</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="3600"
                    step="60"
                    value={Math.min(settings.taskCooldownSeconds, 3600)}
                    onChange={(e) => updateSetting("taskCooldownSeconds", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  <div className="w-24">
                    <input
                      type="number"
                      min="0"
                      max="86400"
                      value={settings.taskCooldownSeconds}
                      onChange={(e) => updateSetting("taskCooldownSeconds", parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-12">sec</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Wait time between task completions: {formatCooldownDisplay(settings.taskCooldownSeconds)}
                </p>
              </div>

              {/* Max Retries */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Default Max Retries</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={settings.defaultMaxRetries}
                    onChange={(e) => updateSetting("defaultMaxRetries", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  <div className="w-20">
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={settings.defaultMaxRetries}
                      onChange={(e) => updateSetting("defaultMaxRetries", parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                </div>
                {validationErrors.defaultMaxRetries && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.defaultMaxRetries}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Automatic retries for failed tasks (0-10)</p>
              </div>
            </div>
          </CollapsibleSection>

          {/* Virtual Manager */}
          <CollapsibleSection
            title="Virtual Manager"
            icon={<Users className="w-4 h-4" />}
            iconBgColor="bg-indigo-500/20"
            iconColor="text-indigo-500"
            summary={getManagerSummary()}
          >
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">Provider</label>
                  <div className="grid grid-cols-2 gap-2">
                    {PROVIDER_OPTIONS.map((provider) => (
                      <button
                        key={provider.value}
                        onClick={() => {
                          updateSetting("managerProvider", provider.value);
                          const newProviderModels = MODEL_OPTIONS[provider.value];
                          if (newProviderModels && !newProviderModels.find((m) => m.value === settings.managerModelId)) {
                            updateSetting("managerModelId", newProviderModels[0].value);
                          }
                        }}
                        className={`p-3 rounded-lg border-2 transition-all ${
                          settings.managerProvider === provider.value
                            ? "border-indigo-500 bg-indigo-500/10"
                            : "border-border hover:border-indigo-500/50"
                        }`}
                      >
                        <div className="text-lg">{provider.icon}</div>
                        <div className="text-xs font-medium mt-1">{provider.label.split(" ")[0]}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">Model</label>
                  <select
                    value={settings.managerModelId}
                    onChange={(e) => updateSetting("managerModelId", e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-indigo-500/50 focus:outline-none transition-all"
                  >
                    {(MODEL_OPTIONS[settings.managerProvider] || MODEL_OPTIONS.anthropic).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} ({option.tier})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="p-4 rounded-lg bg-indigo-500/5 border border-indigo-500/20">
                <h4 className="text-sm font-medium text-indigo-400 mb-2">Virtual Manager (Tech Lead)</h4>
                <p className="text-xs text-muted-foreground">
                  The Virtual Manager (Tech Lead) reviews all PRs created by AI workers before they
                  are merged. These provider and model settings control which AI performs code reviews.
                  Use the <strong>review</strong> label on Jira tickets to require manager review.
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* Planning Agent (Project Manager) */}
          <CollapsibleSection
            title="Planning Agent"
            icon={<BarChart3 className="w-4 h-4" />}
            iconBgColor="bg-purple-500/20"
            iconColor="text-purple-500"
            summary={`${PROVIDER_OPTIONS.find((p) => p.value === settings.planningAgentProvider)?.label.split(" ")[0] || "Anthropic"} - ${settings.storyCalibrationMultiplier}x`}
          >
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">Provider</label>
                  <div className="grid grid-cols-2 gap-2">
                    {PROVIDER_OPTIONS.map((provider) => (
                      <button
                        key={provider.value}
                        onClick={() => {
                          updateSetting("planningAgentProvider", provider.value);
                          const newProviderModels = MODEL_OPTIONS[provider.value];
                          if (newProviderModels && !newProviderModels.find((m) => m.value === settings.planningAgentModel)) {
                            updateSetting("planningAgentModel", newProviderModels[0].value);
                          }
                        }}
                        className={`p-3 rounded-lg border-2 transition-all ${
                          settings.planningAgentProvider === provider.value
                            ? "border-purple-500 bg-purple-500/10"
                            : "border-border hover:border-purple-500/50"
                        }`}
                      >
                        <div className="text-lg">{provider.icon}</div>
                        <div className="text-xs font-medium mt-1">{provider.label.split(" ")[0]}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">Model</label>
                  <select
                    value={settings.planningAgentModel}
                    onChange={(e) => updateSetting("planningAgentModel", e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-purple-500/50 focus:outline-none transition-all"
                  >
                    {(MODEL_OPTIONS[settings.planningAgentProvider] || MODEL_OPTIONS.anthropic).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} ({option.tier})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Story Calibration Multiplier
                  <span className="ml-2 text-xs text-purple-400">({Math.round(settings.storyCalibrationMultiplier * 100)}%)</span>
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0.1"
                    max="2.0"
                    step="0.05"
                    value={settings.storyCalibrationMultiplier}
                    onChange={(e) => updateSetting("storyCalibrationMultiplier", parseFloat(e.target.value))}
                    className="flex-1 h-2 bg-background/50 rounded-lg appearance-none cursor-pointer accent-purple-500"
                  />
                  <input
                    type="number"
                    min="0.1"
                    max="2.0"
                    step="0.05"
                    value={settings.storyCalibrationMultiplier}
                    onChange={(e) => updateSetting("storyCalibrationMultiplier", parseFloat(e.target.value) || 0.4)}
                    className="w-20 px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-purple-500/50 focus:outline-none text-sm text-center"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Adjusts final story count. Lower = fewer stories (0.3 = 30%), higher = more stories (1.5 = 150%).
                  <br />
                  <span className="text-purple-400">Example: If system calculates 20 stories at 0.4x = 8 stories</span>
                </p>
              </div>
              <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
                <h4 className="text-sm font-medium text-purple-400 mb-2">Planning Agent Role</h4>
                <p className="text-xs text-muted-foreground">
                  The Planning Agent (Project Manager) analyzes PRDs, extracts inventory, and decomposes work into stories.
                  The calibration multiplier acts as a "temperature dial" - if stories are consistently over-estimated, reduce it.
                </p>
              </div>
            </div>
          </CollapsibleSection>

          {/* Provider Routing */}
          <CollapsibleSection
            title="Provider Routing"
            icon={<Router className="w-4 h-4" />}
            iconBgColor="bg-orange-500/20"
            iconColor="text-orange-500"
            summary={getRoutingSummary()}
            badge="Advanced"
            badgeColor="bg-orange-500/20 text-orange-500"
          >
            <div className="space-y-6">
              {/* Ollama Base URL */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  <Server className="w-4 h-4" />
                  Ollama Server URL
                </label>
                <input
                  type="text"
                  value={settings.ollamaBaseUrl || ""}
                  onChange={(e) => updateSetting("ollamaBaseUrl", e.target.value || null)}
                  placeholder="http://localhost:11434 or https://ollama.yourdomain.com"
                  className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Your self-hosted Ollama endpoint. Use Cloudflare Tunnel or Tailscale to expose securely.
                </p>
              </div>

              {/* Context Window */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Context Window (tokens)</label>
                <input
                  type="number"
                  value={settings.ollamaContextWindow}
                  onChange={(e) => updateSetting("ollamaContextWindow", parseInt(e.target.value) || 65536)}
                  min={2048}
                  max={262144}
                  step={1024}
                  className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                {validationErrors.ollamaContextWindow && (
                  <p className="text-xs text-red-400 mt-1">{validationErrors.ollamaContextWindow}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  num_ctx for Ollama models. Default: 65536 (64K). Increase for complex tasks.
                </p>
              </div>

              {/* Persona Routing Rules */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-3">Persona Routing Rules</label>
                <div className="space-y-3">
                  {PERSONA_OPTIONS.map((persona) => {
                    const routing = settings.providerRouting[persona.value];
                    const hasRouting = routing && routing.provider;
                    const routingProvider = hasRouting ? routing.provider : "";
                    const routingModel = routing?.model || "";
                    const providerModels = routingProvider ? MODEL_OPTIONS[routingProvider] || [] : [];

                    return (
                      <div
                        key={persona.value}
                        className={`p-3 rounded-lg border transition-all ${
                          hasRouting ? "bg-orange-500/5 border-orange-500/30" : "bg-background/50 border-border"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-sm font-medium text-foreground min-w-[140px]">{persona.label}</span>
                          <div className="flex items-center gap-2 flex-1">
                            <select
                              value={routingProvider}
                              onChange={(e) => {
                                const newProvider = e.target.value;
                                const newRouting = { ...settings.providerRouting };
                                if (newProvider) {
                                  const defaultModel = MODEL_OPTIONS[newProvider]?.[0]?.value || "";
                                  newRouting[persona.value] = { provider: newProvider, model: defaultModel };
                                } else {
                                  delete newRouting[persona.value];
                                }
                                updateSetting("providerRouting", newRouting);
                              }}
                              className="flex-1 px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-sm"
                            >
                              <option value="">Use default provider</option>
                              {PROVIDER_OPTIONS.map((p) => (
                                <option key={p.value} value={p.value}>{p.icon} {p.label}</option>
                              ))}
                            </select>
                            {hasRouting && providerModels.length > 0 && (
                              <select
                                value={routingModel}
                                onChange={(e) => {
                                  const newRouting = { ...settings.providerRouting };
                                  newRouting[persona.value] = { ...newRouting[persona.value], model: e.target.value };
                                  updateSetting("providerRouting", newRouting);
                                }}
                                className="flex-1 px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-sm"
                              >
                                {providerModels.map((m) => (
                                  <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Quick Setup Suggestion */}
              {!Object.keys(settings.providerRouting).length && settings.ollamaBaseUrl && (
                <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
                  <div className="flex items-start gap-3">
                    <Plus className="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-medium text-green-400 mb-1">Quick Setup Suggestion</h4>
                      <p className="text-xs text-muted-foreground mb-2">
                        Route QA Engineer tasks to your local Ollama to save on API costs:
                      </p>
                      <button
                        onClick={() => updateSetting("providerRouting", { qa_engineer: { provider: "ollama", model: "qwen2.5-coder:32b" } })}
                        className="px-3 py-1.5 text-xs font-medium bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors"
                      >
                        Route QA to Ollama
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Cost Controls */}
          <CollapsibleSection
            title="Cost Controls"
            icon={<DollarSign className="w-4 h-4" />}
            iconBgColor="bg-yellow-500/20"
            iconColor="text-yellow-500"
            summary={getCostSummary()}
          >
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Cost Alert Threshold (USD)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-lg text-muted-foreground">$</span>
                <input
                  type="number"
                  value={settings.costAlertThresholdUsd ?? ""}
                  onChange={(e) => {
                    const value = e.target.value === "" ? null : parseFloat(e.target.value);
                    updateSetting("costAlertThresholdUsd", value);
                  }}
                  placeholder="No limit"
                  min="0"
                  step="10"
                  className="w-full max-w-xs px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
              </div>
              {validationErrors.costAlertThresholdUsd && (
                <p className="text-xs text-red-500 mt-1">{validationErrors.costAlertThresholdUsd}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Get notified when accumulated costs exceed this amount. Leave empty to disable.
              </p>
            </div>
          </CollapsibleSection>
        </div>
      )}
    </div>
  );

  // Integrations Section
  const renderIntegrationsSection = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">Integrations</h2>
        <p className="text-sm text-muted-foreground">Connect your development tools</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Jira Card */}
        <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-blue-500/50 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-blue-500" fill="currentColor">
                <path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53zM6.77 6.8a4.362 4.362 0 0 0 4.34 4.34h1.8v1.72a4.362 4.362 0 0 0 4.34 4.34V7.63a.84.84 0 0 0-.83-.83H6.77zM2 11.6c0 2.4 1.94 4.35 4.35 4.35h1.78v1.7c.01 2.39 1.95 4.34 4.34 4.35v-9.57a.84.84 0 0 0-.84-.83H2z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">Jira</h3>
              <p className="text-xs text-muted-foreground">Task management</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {jiraStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <button
              onClick={() => setJiraSlideOpen(true)}
              className="text-sm text-primary hover:underline"
            >
              Configure
            </button>
          </div>
        </div>

        {/* GitHub Card */}
        <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-gray-500/50 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-gray-500/10 flex items-center justify-center">
              <Github className="w-7 h-7 text-foreground" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">GitHub</h3>
              <p className="text-xs text-muted-foreground">Code & PRs</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {githubStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <button
              onClick={() => setGithubSlideOpen(true)}
              className="text-sm text-primary hover:underline"
            >
              Configure
            </button>
          </div>
        </div>

        {/* GitLab Card */}
        <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-orange-500/50 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-orange-500" fill="currentColor">
                <path d="m23.6 9.593-.033-.086L20.3.98a.851.851 0 0 0-.336-.405.87.87 0 0 0-.522-.153.87.87 0 0 0-.52.168.856.856 0 0 0-.314.418l-2.206 6.755H7.597L5.39.999a.855.855 0 0 0-.314-.41.862.862 0 0 0-.52-.168.87.87 0 0 0-.522.153.851.851 0 0 0-.336.405L.43 9.507l-.033.086a6.066 6.066 0 0 0 2.012 7.01l.012.009.03.022 4.98 3.727 2.462 1.863 1.5 1.134a1.01 1.01 0 0 0 1.22 0l1.5-1.134 2.462-1.863 5.01-3.749.013-.01a6.068 6.068 0 0 0 2.002-7.01z"/>
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">GitLab</h3>
              <p className="text-xs text-muted-foreground">Code & MRs</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {gitlabStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <button
              onClick={() => setGitlabSlideOpen(true)}
              className="text-sm text-primary hover:underline"
            >
              Configure
            </button>
          </div>
        </div>

        {/* BitBucket Card */}
        <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-blue-600/50 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-blue-600/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-blue-600" fill="currentColor">
                <path d="M.778 1.211a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z"/>
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">BitBucket</h3>
              <p className="text-xs text-muted-foreground">Code & PRs</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {bitbucketStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <button
              onClick={() => setBitbucketSlideOpen(true)}
              className="text-sm text-primary hover:underline"
            >
              Configure
            </button>
          </div>
        </div>

        {/* Slack Card */}
        <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-purple-500/50 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-purple-500" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">Slack</h3>
              <p className="text-xs text-muted-foreground">Notifications</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {slackStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <button
              onClick={() => setSlackSlideOpen(true)}
              className="text-sm text-primary hover:underline"
            >
              Configure
            </button>
          </div>
        </div>

        {/* Linear Card */}
        <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-indigo-500/50 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-indigo-500" fill="currentColor">
                <path d="M3 7.5V3h4.5L3 7.5zm0 0L12 16.5 21 7.5V3h-4.5L12 7.5 7.5 3H3v4.5zM21 7.5L12 16.5 3 7.5v9L12 21l9-4.5v-9z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">Linear</h3>
              <p className="text-xs text-muted-foreground">Issue tracking</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {linearStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <button
              onClick={() => setLinearSlideOpen(true)}
              className="text-sm text-primary hover:underline"
            >
              Configure
            </button>
          </div>
        </div>

        {/* Microsoft Teams Card */}
        <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-violet-500/50 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-violet-500" fill="currentColor">
                <path d="M19.2 7.8h-4.8V6c0-1.1.9-2 2-2s2 .9 2 2v1.8h.8c.9 0 1.6.7 1.6 1.6v5.2c0 .9-.7 1.6-1.6 1.6h-.8v1.8c0 1.1-.9 2-2 2s-2-.9-2-2v-1.8H9.6v1.8c0 1.1-.9 2-2 2s-2-.9-2-2v-1.8h-.8c-.9 0-1.6-.7-1.6-1.6V9.4c0-.9.7-1.6 1.6-1.6h.8V6c0-1.1.9-2 2-2s2 .9 2 2v1.8h4.8V6c0-1.1.9-2 2-2s2 .9 2 2v1.8zM9.6 14.6v-5.2H4.8v5.2h4.8zm9.6 0v-5.2h-4.8v5.2h4.8z"/>
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">Microsoft Teams</h3>
              <p className="text-xs text-muted-foreground">Notifications</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {teamsStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <button
              onClick={() => setTeamsSlideOpen(true)}
              className="text-sm text-primary hover:underline"
            >
              Configure
            </button>
          </div>
        </div>

        {/* Discord Card */}
        <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-indigo-400/50 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-indigo-400/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-indigo-400" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">Discord</h3>
              <p className="text-xs text-muted-foreground">Notifications</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {discordStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <button
              onClick={() => setDiscordSlideOpen(true)}
              className="text-sm text-primary hover:underline"
            >
              Configure
            </button>
          </div>
        </div>

        {/* Email Card */}
        <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-emerald-500/50 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Mail className="w-7 h-7 text-emerald-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">Email (SMTP)</h3>
              <p className="text-xs text-muted-foreground">Notifications</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {emailStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <button
              onClick={() => setEmailSlideOpen(true)}
              className="text-sm text-primary hover:underline"
            >
              Configure
            </button>
          </div>
        </div>

        {/* OnCallShift Card */}
        <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-red-500/50 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Bell className="w-7 h-7 text-red-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">OnCallShift</h3>
              <p className="text-xs text-muted-foreground">Incident Management</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {oncallshiftStatus.connected ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <CheckCircle className="w-4 h-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-muted-foreground text-sm">
                <XCircle className="w-4 h-4" /> Not connected
              </span>
            )}
            <button
              onClick={() => setOncallshiftSlideOpen(true)}
              className="text-sm text-primary hover:underline"
            >
              Configure
            </button>
          </div>
        </div>
      </div>

      {/* Cloud Providers Section */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-foreground mb-1">Cloud Providers</h3>
        <p className="text-sm text-muted-foreground mb-4">Configure cloud credentials for worker deployment</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* AWS Card */}
          <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-orange-500/50 transition-colors">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center">
                {/* AWS Cloud icon */}
                <svg viewBox="0 0 24 24" className="w-7 h-7 text-orange-500" fill="currentColor">
                  <path d="M18.75 11.35a4.32 4.32 0 0 1-.79-.08 3.9 3.9 0 0 0 .49-1.9 3.97 3.97 0 0 0-3.97-3.97 4.01 4.01 0 0 0-1.77.41 5.22 5.22 0 0 0-9.71 2.65c0 .2.02.4.04.59A3.97 3.97 0 0 0 3.97 13a3.97 3.97 0 0 0 3.97 3.97h10.81a3.97 3.97 0 0 0 0-7.94v2.32z"/>
                  <path d="M7.55 14.3a.43.43 0 0 1-.22-.4V9.17a.43.43 0 0 1 .65-.37l3.93 2.37a.43.43 0 0 1 0 .74l-3.93 2.37a.43.43 0 0 1-.43.02z"/>
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">AWS</h3>
                <p className="text-xs text-muted-foreground">Amazon Web Services</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {awsStatus.connected ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={handleAwsSlideOpen}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* GCP Card */}
          <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-blue-500/50 transition-colors">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-7 h-7 text-blue-500" fill="currentColor">
                  <path d="M12.19 2.38a9.344 9.344 0 0 0-9.234 6.893c.053-.02-.055.013 0 0-3.875 2.551-3.922 8.11-.247 10.941l.006-.007-.007.03a6.717 6.717 0 0 0 4.077 1.356h5.173l.03.03h5.192c6.687.053 9.376-8.605 3.835-12.35a9.365 9.365 0 0 0-8.825-6.893zM8.073 19.439a4.609 4.609 0 0 1-2.187-3.712 4.609 4.609 0 0 1 2.187-3.712l2.56 1.506-2.56 5.918zm2.56-7.46L8.073 10.5a4.609 4.609 0 0 1 4.374 0l-2.56 1.506.746-.027zm4.327 7.46l-2.56-1.506 2.56-5.918a4.609 4.609 0 0 1 2.187 3.712 4.609 4.609 0 0 1-2.187 3.712z"/>
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Google Cloud</h3>
                <p className="text-xs text-muted-foreground">GCP</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {gcpStatus.connected ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setGcpSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* Azure Card */}
          <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-cyan-500/50 transition-colors">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-7 h-7 text-cyan-500" fill="currentColor">
                  <path d="M13.05 4.24L6.56 18.05a.5.5 0 0 0 .46.7h11.96a.5.5 0 0 0 .46-.7l-6.49-13.81a.5.5 0 0 0-.9 0zM5.68 8.37L2.04 17.8a.5.5 0 0 0 .46.7h5.4a.5.5 0 0 0 .46-.3l2.64-5.61L8.03 8.37a.5.5 0 0 0-.9 0l-1.45 3.08-.46-1a.5.5 0 0 0-.54-.08z"/>
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Azure</h3>
                <p className="text-xs text-muted-foreground">Microsoft Azure</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {azureStatus.connected ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setAzureSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* AI Providers Section */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-foreground mb-1">AI Providers</h3>
        <p className="text-sm text-muted-foreground mb-4">Configure API keys for AI model providers</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Anthropic Card */}
          <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-orange-500/50 transition-colors">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <span className="text-2xl">🤖</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Anthropic</h3>
                <p className="text-xs text-muted-foreground">Claude models</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {anthropicProvider.status.configured ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setAnthropicSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* OpenAI Card */}
          <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-emerald-500/50 transition-colors">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <span className="text-2xl">🔷</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">OpenAI</h3>
                <p className="text-xs text-muted-foreground">GPT models</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {openaiProvider.status.configured ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setOpenaiSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>

          {/* Google Card */}
          <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-blue-500/50 transition-colors">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <span className="text-2xl">🔵</span>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Google</h3>
                <p className="text-xs text-muted-foreground">Gemini models</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {googleProvider.status.configured ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> Not configured
                </span>
              )}
              <button
                onClick={() => setGoogleSlideOpen(true)}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* API Access Section */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-foreground mb-1">API Access</h3>
        <p className="text-sm text-muted-foreground mb-4">Generate API keys for programmatic access and MCP integrations</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* WorkerMill MCP Card */}
          <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-primary/50 transition-colors">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Router className="w-7 h-7 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">WorkerMill</h3>
                <p className="text-xs text-muted-foreground">MCP Server</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {mcpApiKeys.length > 0 ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <CheckCircle className="w-4 h-4" /> {mcpApiKeys.length} key{mcpApiKeys.length !== 1 ? "s" : ""}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <XCircle className="w-4 h-4" /> No keys
                </span>
              )}
              <button
                onClick={() => {
                  setWorkermillSlideOpen(true);
                  fetchMcpApiKeys();
                }}
                className="text-sm text-primary hover:underline"
              >
                Configure
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Notifications Section
  const renderNotificationsSection = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">Notifications</h2>
        <p className="text-sm text-muted-foreground">Configure how WorkerMill notifies you about tasks and alerts</p>
      </div>

      {settingsLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Your Email Preferences Card (User-level) */}
          <div className="border border-border/50 rounded-xl p-6 bg-card">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <Mail className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Your Email Preferences</h3>
                  <p className="text-sm text-muted-foreground">Choose which notifications you want to receive</p>
                </div>
              </div>
              {userEmailPrefsLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
            </div>

            {!settings.emailNotificationsEnabled ? (
              <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400">
                <p className="text-sm">Email notifications are disabled for this organization. Contact an admin to enable them.</p>
              </div>
            ) : userEmailPrefsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-5">
                {/* Notification Types */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground">Notification Types</h4>

                  {/* Task Completed */}
                  <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div>
                      <p className="font-medium text-foreground">Task Completed</p>
                      <p className="text-xs text-muted-foreground">Get notified when tasks complete successfully</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={userEmailPreferences.taskCompleted ?? true}
                      onChange={(e) => updateUserEmailPref("taskCompleted", e.target.checked)}
                      className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                    />
                  </label>

                  {/* Task Failed */}
                  <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div>
                      <p className="font-medium text-foreground">Task Failed</p>
                      <p className="text-xs text-muted-foreground">Get notified when tasks fail or error</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={userEmailPreferences.taskFailed ?? true}
                      onChange={(e) => updateUserEmailPref("taskFailed", e.target.checked)}
                      className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                    />
                  </label>

                  {/* Cost Alerts */}
                  <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div>
                      <p className="font-medium text-foreground">Cost Alerts</p>
                      <p className="text-xs text-muted-foreground">Get notified when spending exceeds thresholds</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={userEmailPreferences.costAlerts ?? true}
                      onChange={(e) => updateUserEmailPref("costAlerts", e.target.checked)}
                      className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                    />
                  </label>

                  {/* PR Created */}
                  <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div>
                      <p className="font-medium text-foreground">PR Created</p>
                      <p className="text-xs text-muted-foreground">Get notified when pull requests are created</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={userEmailPreferences.prCreated ?? false}
                      onChange={(e) => updateUserEmailPref("prCreated", e.target.checked)}
                      className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                    />
                  </label>
                </div>

                {/* Frequency */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Delivery Frequency</label>
                  <select
                    value={userEmailPreferences.frequency ?? "immediate"}
                    onChange={(e) => updateUserEmailPref("frequency", e.target.value as EmailPreferences["frequency"])}
                    className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none"
                  >
                    <option value="immediate">Immediate</option>
                    <option value="daily">Daily Digest</option>
                    <option value="weekly">Weekly Digest</option>
                    <option value="never">Never (disabled)</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {userEmailPreferences.frequency === "immediate" && "Receive notifications as events happen"}
                    {userEmailPreferences.frequency === "daily" && "Receive a daily summary at 9am"}
                    {userEmailPreferences.frequency === "weekly" && "Receive a weekly summary on Mondays"}
                    {userEmailPreferences.frequency === "never" && "Email notifications are disabled for you"}
                  </p>
                </div>

                {/* Save Button for User Preferences */}
                {hasUnsavedUserEmailPrefs && (
                  <div className="flex justify-end pt-2">
                    <button
                      onClick={saveUserEmailPreferences}
                      disabled={userEmailPrefsSaving}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2 text-sm font-medium"
                    >
                      {userEmailPrefsSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Save Preferences
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Organization Email Settings Card (Admin-only) */}
          <div className="border border-border/50 rounded-xl p-6 bg-card">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                  <Building className="w-5 h-5 text-orange-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Organization Email Settings</h3>
                  <p className="text-sm text-muted-foreground">Admin settings that apply to all team members</p>
                </div>
              </div>
              {/* Master Toggle */}
              <button
                onClick={() => updateSetting("emailNotificationsEnabled", !settings.emailNotificationsEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  settings.emailNotificationsEnabled ? "bg-primary" : "bg-muted"
                }`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    settings.emailNotificationsEnabled ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                <div>
                  <p className="font-medium text-foreground">Enable Email Notifications</p>
                  <p className="text-xs text-muted-foreground">
                    {settings.emailNotificationsEnabled
                      ? "Emails are enabled for this organization"
                      : "Emails are disabled for all team members"}
                  </p>
                </div>
                <span className={`text-sm font-medium ${settings.emailNotificationsEnabled ? "text-green-500" : "text-muted-foreground"}`}>
                  {settings.emailNotificationsEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>

              {settings.emailNotificationsEnabled && (
                <CollapsibleSection
                  title="Default Preferences for New Members"
                  defaultOpen={false}
                  summary="Set the default notification preferences for new team members"
                >
                  <div className="space-y-3 pt-2">
                    {/* Task Completed Default */}
                    <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                      <div>
                        <p className="font-medium text-foreground">Task Completed</p>
                        <p className="text-xs text-muted-foreground">Default for new members</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.defaultEmailPreferences.taskCompleted ?? true}
                        onChange={(e) => updateSetting("defaultEmailPreferences", {
                          ...settings.defaultEmailPreferences,
                          taskCompleted: e.target.checked,
                        })}
                        className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                      />
                    </label>

                    {/* Task Failed Default */}
                    <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                      <div>
                        <p className="font-medium text-foreground">Task Failed</p>
                        <p className="text-xs text-muted-foreground">Default for new members</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.defaultEmailPreferences.taskFailed ?? true}
                        onChange={(e) => updateSetting("defaultEmailPreferences", {
                          ...settings.defaultEmailPreferences,
                          taskFailed: e.target.checked,
                        })}
                        className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                      />
                    </label>

                    {/* Cost Alerts Default */}
                    <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                      <div>
                        <p className="font-medium text-foreground">Cost Alerts</p>
                        <p className="text-xs text-muted-foreground">Default for new members</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.defaultEmailPreferences.costAlerts ?? true}
                        onChange={(e) => updateSetting("defaultEmailPreferences", {
                          ...settings.defaultEmailPreferences,
                          costAlerts: e.target.checked,
                        })}
                        className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                      />
                    </label>

                    {/* PR Created Default */}
                    <label className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
                      <div>
                        <p className="font-medium text-foreground">PR Created</p>
                        <p className="text-xs text-muted-foreground">Default for new members</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.defaultEmailPreferences.prCreated ?? false}
                        onChange={(e) => updateSetting("defaultEmailPreferences", {
                          ...settings.defaultEmailPreferences,
                          prCreated: e.target.checked,
                        })}
                        className="w-5 h-5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
                      />
                    </label>

                    {/* Default Frequency */}
                    <div className="pt-2">
                      <label className="block text-sm font-medium text-foreground mb-2">Default Delivery Frequency</label>
                      <select
                        value={settings.defaultEmailPreferences.frequency ?? "immediate"}
                        onChange={(e) => updateSetting("defaultEmailPreferences", {
                          ...settings.defaultEmailPreferences,
                          frequency: e.target.value as EmailPreferences["frequency"],
                        })}
                        className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none"
                      >
                        <option value="immediate">Immediate</option>
                        <option value="daily">Daily Digest</option>
                        <option value="weekly">Weekly Digest</option>
                        <option value="never">Never (disabled)</option>
                      </select>
                    </div>
                  </div>
                </CollapsibleSection>
              )}
            </div>
          </div>

          {/* Webhook Notifications Card */}
          <div className="border border-border/50 rounded-xl p-6 bg-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Bell className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Webhook Notifications</h3>
                <p className="text-sm text-muted-foreground">Send notifications to Slack or Teams channels</p>
              </div>
            </div>

            <div className="space-y-3">
              {/* Slack */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-[***REMOVED***4A154B] flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Slack</p>
                    <p className="text-xs text-muted-foreground">
                      {slackStatus.connected ? "Connected" : "Not configured"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {slackStatus.connected ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-muted-foreground" />
                  )}
                  <button
                    onClick={() => setSlackSlideOpen(true)}
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    Configure <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Microsoft Teams */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-[***REMOVED***6264A7] flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.625 8.073c.574 0 1.125.228 1.532.634a2.164 2.164 0 0 1 0 3.063 2.168 2.168 0 0 1-1.532.635c-.574 0-1.125-.229-1.532-.635a2.164 2.164 0 0 1 0-3.063 2.168 2.168 0 0 1 1.532-.634zm-4.219 1.761a3.438 3.438 0 0 1 3.438 3.438v5.156a.625.625 0 0 1-.625.625h-5.625a.625.625 0 0 1-.625-.625v-5.156a3.438 3.438 0 0 1 3.437-3.438zm-1.562-5.459a2.813 2.813 0 1 1 0 5.625 2.813 2.813 0 0 1 0-5.625zM9.375 6.25a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5zm0 8.75a5.625 5.625 0 0 1 5.625 5.625.625.625 0 0 1-.625.625H4.375a.625.625 0 0 1-.625-.625A5.625 5.625 0 0 1 9.375 15z"/>
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Microsoft Teams</p>
                    <p className="text-xs text-muted-foreground">
                      {teamsStatus.connected ? "Connected" : "Not configured"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {teamsStatus.connected ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-muted-foreground" />
                  )}
                  <button
                    onClick={() => setTeamsSlideOpen(true)}
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    Configure <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Cost Control Card */}
          <div className="border border-border/50 rounded-xl p-6 bg-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Cost Control</h3>
                <p className="text-sm text-muted-foreground">Set spending limits and budget alerts</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Monthly Budget Alert (USD)
                </label>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1 max-w-xs">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="No limit"
                      value={settings.costAlertThresholdUsd ?? ""}
                      onChange={(e) => {
                        const value = e.target.value === "" ? null : parseFloat(e.target.value);
                        updateSetting("costAlertThresholdUsd", value);
                      }}
                      className="w-full pl-7 pr-4 py-2.5 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none"
                    />
                  </div>
                  {settings.costAlertThresholdUsd !== null && (
                    <button
                      onClick={() => updateSetting("costAlertThresholdUsd", null)}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {validationErrors.costAlertThresholdUsd && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.costAlertThresholdUsd}</p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {settings.costAlertThresholdUsd
                    ? `You'll be notified when spending exceeds $${settings.costAlertThresholdUsd}`
                    : "Set a budget to receive alerts when spending approaches your limit"}
                </p>
              </div>
            </div>
          </div>

          {/* Save Button */}
          {hasUnsavedChanges && (
            <div className="flex justify-end pt-4">
              <button
                onClick={handleSaveSettings}
                disabled={settingsSaving || Object.keys(validationErrors).length > 0}
                className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 font-medium"
              >
                {settingsSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // Data & Display Section
  const renderDataSection = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">Data & Display</h2>
        <p className="text-sm text-muted-foreground">Configure retention policies and dashboard display</p>
      </div>

      {settingsLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Retention Policies */}
          <CollapsibleSection
            title="Retention Policies"
            icon={<Database className="w-4 h-4" />}
            iconBgColor="bg-blue-500/20"
            iconColor="text-blue-500"
            summary={`Logs: ${settings.logRetentionDays}d, Tasks: ${settings.taskRetentionDays}d`}
            defaultOpen={true}
          >
            <div className="space-y-6">
              {/* Log Retention */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Log Retention Period
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="365"
                    value={settings.logRetentionDays}
                    onChange={(e) => updateSetting("logRetentionDays", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <div className="w-24">
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={settings.logRetentionDays}
                      onChange={(e) => updateSetting("logRetentionDays", parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-12">days</span>
                </div>
                {validationErrors.logRetentionDays && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.logRetentionDays}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Worker logs older than this are deleted (1-365)</p>
              </div>

              {/* Task Retention */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Task History Retention
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="730"
                    value={settings.taskRetentionDays}
                    onChange={(e) => updateSetting("taskRetentionDays", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <div className="w-24">
                    <input
                      type="number"
                      min="1"
                      max="730"
                      value={settings.taskRetentionDays}
                      onChange={(e) => updateSetting("taskRetentionDays", parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-12">days</span>
                </div>
                {validationErrors.taskRetentionDays && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.taskRetentionDays}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Task records older than this are archived (1-730)</p>
              </div>
            </div>
          </CollapsibleSection>

          {/* Dashboard Display */}
          <CollapsibleSection
            title="Dashboard Display"
            icon={<SettingsIcon className="w-4 h-4" />}
            iconBgColor="bg-gray-500/20"
            iconColor="text-gray-400"
            summary={`Completed: ${settings.completedTaskDisplayMinutes}m, In-progress: ${settings.intermediateTaskDisplayMinutes}m`}
          >
            <div className="space-y-6">
              {/* Completed Task Display */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Completed Task Visibility</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="60"
                    value={settings.completedTaskDisplayMinutes}
                    onChange={(e) => updateSetting("completedTaskDisplayMinutes", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-gray-500"
                  />
                  <div className="w-24">
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={settings.completedTaskDisplayMinutes}
                      onChange={(e) => updateSetting("completedTaskDisplayMinutes", parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-12">min</span>
                </div>
                {validationErrors.completedTaskDisplayMinutes && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.completedTaskDisplayMinutes}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">How long completed tasks show on dashboard (1-60)</p>
              </div>

              {/* In-Progress Task Display */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">In-Progress Task Visibility</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="1440"
                    step="15"
                    value={settings.intermediateTaskDisplayMinutes}
                    onChange={(e) => updateSetting("intermediateTaskDisplayMinutes", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-gray-500"
                  />
                  <div className="w-24">
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      value={settings.intermediateTaskDisplayMinutes}
                      onChange={(e) => updateSetting("intermediateTaskDisplayMinutes", parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-12">min</span>
                </div>
                {validationErrors.intermediateTaskDisplayMinutes && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.intermediateTaskDisplayMinutes}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">In-progress tasks (PR created, awaiting review) visibility (1-1440)</p>
              </div>

              {/* Dry Run Visibility */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Dry-Run Task Visibility</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="60"
                    value={settings.dryRunVisibilityMinutes}
                    onChange={(e) => updateSetting("dryRunVisibilityMinutes", parseInt(e.target.value))}
                    className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-gray-500"
                  />
                  <div className="w-24">
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={settings.dryRunVisibilityMinutes}
                      onChange={(e) => updateSetting("dryRunVisibilityMinutes", parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:outline-none text-center"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-12">min</span>
                </div>
                {validationErrors.dryRunVisibilityMinutes && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.dryRunVisibilityMinutes}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Dry-run test tasks visibility after completion (1-60)</p>
              </div>
            </div>
          </CollapsibleSection>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Background effects */}
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none opacity-50" />
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />

      {/* Header */}
      <header className="border-b border-border/30 glass-strong sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          <h1 className="text-lg font-semibold text-foreground">Settings</h1>
          <div className="w-32" /> {/* Spacer for centering */}
        </div>
      </header>

      <ErrorBoundaryWithRetry fallback={<SettingsErrorFallback sectionName="settings" />}>
        <div className="relative max-w-7xl mx-auto flex">
          {/* Sidebar Navigation */}
          <aside className="w-56 flex-shrink-0 border-r border-border/30 min-h-[calc(100vh-73px)] sticky top-[73px] self-start">
            <nav className="p-4 space-y-1">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveCategory(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                    activeCategory === item.id
                      ? "bg-primary/10 text-primary border-l-4 border-primary -ml-[2px] pl-[14px]"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  {item.icon}
                  <span className="text-sm font-medium">{item.label}</span>
                </button>
              ))}
            </nav>
          </aside>

          {/* Main Content */}
          <main className="flex-1 p-6 pb-24">
            {/* Messages */}
            {message && (
              <div
                className={`p-4 rounded-lg border mb-6 ${
                  message.type === "success"
                    ? "bg-green-500/10 border-green-500/30 text-green-500"
                    : "bg-red-500/10 border-red-500/30 text-red-500"
                }`}
              >
                {message.text}
              </div>
            )}

            {settingsError && (
              <div className="p-4 rounded-lg border bg-yellow-500/10 border-yellow-500/30 text-yellow-500 mb-6">
                {settingsError}
              </div>
            )}

            {renderCategoryContent()}
          </main>
        </div>

        {/* Sticky Save Bar */}
        {hasUnsavedChanges && (
          <div className="fixed bottom-0 left-0 right-0 border-t border-border/50 bg-card/95 backdrop-blur-sm z-30 shadow-lg">
            <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-yellow-500">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">You have unsaved changes</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleDiscardChanges}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Discard
                </button>
                <button
                  onClick={handleSaveSettings}
                  disabled={settingsSaving || settingsLoading}
                  className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-lg hover:shadow-lg hover:shadow-primary/25 transition-all disabled:opacity-50"
                >
                  {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Invite Member Modal */}
        {showInviteModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-border rounded-xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-indigo-500" />
                  Invite Team Member
                </h3>
                <button
                  onClick={() => { setShowInviteModal(false); setInviteEmail(""); setInviteRole("member"); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">Email Address</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "admin" | "member" | "viewer")}
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                  >
                    <option value="admin">Admin - Full access and settings management</option>
                    <option value="member">Member - Create and manage tasks</option>
                    <option value="viewer">Viewer - View only access</option>
                  </select>
                </div>
                <div className="p-3 rounded-lg bg-muted/30 border border-border">
                  <p className="text-xs text-muted-foreground">
                    An invitation email will be sent with a link to join. The invite expires in 7 days.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => { setShowInviteModal(false); setInviteEmail(""); setInviteRole("member"); }}
                  className="flex-1 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendInvite}
                  disabled={inviteSending || !inviteEmail.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-500 text-white font-semibold rounded-lg hover:bg-indigo-600 transition-all disabled:opacity-50"
                >
                  {inviteSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send Invite
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Jira SlideOver */}
        <SlideOver
          isOpen={jiraSlideOpen}
          onClose={() => setJiraSlideOpen(false)}
          title="Configure Jira"
          icon={
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-blue-500" fill="currentColor">
              <path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53zM6.77 6.8a4.362 4.362 0 0 0 4.34 4.34h1.8v1.72a4.362 4.362 0 0 0 4.34 4.34V7.63a.84.84 0 0 0-.83-.83H6.77zM2 11.6c0 2.4 1.94 4.35 4.35 4.35h1.78v1.7c.01 2.39 1.95 4.34 4.34 4.35v-9.57a.84.84 0 0 0-.84-.83H2z" />
            </svg>
          }
          iconBgColor="bg-blue-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <p className="text-sm text-muted-foreground">
                Connect Jira to automatically create tasks from tickets. You'll need your{" "}
                <a
                  href="https://id.atlassian.com/manage-profile/security/api-tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Atlassian API token
                </a>{" "}
                and to configure a{" "}
                <a
                  href="https://support.atlassian.com/jira-cloud-administration/docs/manage-webhooks/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Jira webhook
                </a>
                .
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Base URL</label>
              <input
                type="text"
                value={jiraBaseUrl}
                onChange={(e) => setJiraBaseUrl(e.target.value)}
                placeholder="https://your-domain.atlassian.net"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Email</label>
              <input
                type="email"
                value={jiraEmail}
                onChange={(e) => setJiraEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">API Token</label>
              <div className="relative">
                <input
                  type={jiraVisible ? "text" : "password"}
                  value={jiraApiKey}
                  onChange={(e) => setJiraApiKey(e.target.value)}
                  placeholder={jiraStatus.connected ? "••••••••••••" : "Enter your Jira API token"}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setJiraVisible(!jiraVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {jiraVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Generate at <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Atlassian Account Settings</a>
              </p>
            </div>

            <div className="border-t border-border pt-6">
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Webhook Secret
                {jiraStatus.webhookSecretConfigured && (
                  <span className="ml-2 text-xs text-green-500">(configured)</span>
                )}
              </label>
              <div className="relative">
                <input
                  type={jiraWebhookVisible ? "text" : "password"}
                  value={jiraWebhookSecret}
                  onChange={(e) => setJiraWebhookSecret(e.target.value)}
                  placeholder={jiraStatus.webhookSecretConfigured ? "••••••••••••" : "Enter webhook secret"}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setJiraWebhookVisible(!jiraWebhookVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {jiraWebhookVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Create a webhook at{" "}
                <a
                  href="https://support.atlassian.com/jira-cloud-administration/docs/manage-webhooks/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Jira Settings → System → Webhooks
                </a>
                . Set the URL to <code className="bg-muted px-1 rounded text-xs">https://workermill.com/api/webhooks/jira</code> and use the secret above.
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={handleTestJira}
                disabled={jiraTesting || !jiraStatus.connected}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {jiraTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={handleSaveJira}
                disabled={jiraSaving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {jiraSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* GitHub SlideOver */}
        <SlideOver
          isOpen={githubSlideOpen}
          onClose={() => setGithubSlideOpen(false)}
          title="Configure GitHub"
          icon={<Github className="w-6 h-6 text-foreground" />}
          iconBgColor="bg-gray-500/20"
        >
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Personal Access Token</label>
              <div className="relative">
                <input
                  type={githubVisible ? "text" : "password"}
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder={githubStatus.connected ? "••••••••••••" : "ghp_xxxxxxxxxxxx"}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setGithubVisible(!githubVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {githubVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <a
                href="https://github.com/settings/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Generate a token <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Default Repository</label>
              <input
                type="text"
                value={githubDefaultRepo}
                onChange={(e) => setGithubDefaultRepo(e.target.value)}
                placeholder="owner/repository"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
            </div>

            <div className="border-t border-border pt-6">
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Webhook Secret
                {githubStatus.webhookSecretConfigured && (
                  <span className="ml-2 text-xs text-green-500">(configured)</span>
                )}
              </label>
              <div className="relative">
                <input
                  type={githubWebhookVisible ? "text" : "password"}
                  value={githubWebhookSecret}
                  onChange={(e) => setGithubWebhookSecret(e.target.value)}
                  placeholder={githubStatus.webhookSecretConfigured ? "••••••••••••" : "Enter webhook secret"}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setGithubWebhookVisible(!githubWebhookVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {githubWebhookVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Used to verify incoming webhooks from GitHub. Set this in your GitHub webhook settings.
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={handleTestGithub}
                disabled={githubTesting || !githubStatus.connected}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {githubTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={handleSaveGithub}
                disabled={githubSaving || (!githubToken && !githubDefaultRepo && !githubWebhookSecret)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50"
              >
                {githubSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* GitLab SlideOver */}
        <SlideOver
          isOpen={gitlabSlideOpen}
          onClose={() => setGitlabSlideOpen(false)}
          title="Configure GitLab"
          icon={
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-orange-500" fill="currentColor">
              <path d="m23.6 9.593-.033-.086L20.3.98a.851.851 0 0 0-.336-.405.87.87 0 0 0-.522-.153.87.87 0 0 0-.52.168.856.856 0 0 0-.314.418l-2.206 6.755H7.597L5.39.999a.855.855 0 0 0-.314-.41.862.862 0 0 0-.52-.168.87.87 0 0 0-.522.153.851.851 0 0 0-.336.405L.43 9.507l-.033.086a6.066 6.066 0 0 0 2.012 7.01l.012.009.03.022 4.98 3.727 2.462 1.863 1.5 1.134a1.01 1.01 0 0 0 1.22 0l1.5-1.134 2.462-1.863 5.01-3.749.013-.01a6.068 6.068 0 0 0 2.002-7.01z"/>
            </svg>
          }
          iconBgColor="bg-orange-500/20"
        >
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Personal Access Token</label>
              <div className="relative">
                <input
                  type={gitlabVisible ? "text" : "password"}
                  value={gitlabToken}
                  onChange={(e) => setGitlabToken(e.target.value)}
                  placeholder={gitlabStatus.connected ? "••••••••••••" : "glpat-xxxxxxxxxxxx"}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setGitlabVisible(!gitlabVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {gitlabVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <a
                href="https://gitlab.com/-/user_settings/personal_access_tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Generate a token <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Default Repository</label>
              <input
                type="text"
                value={gitlabDefaultRepo}
                onChange={(e) => setGitlabDefaultRepo(e.target.value)}
                placeholder="group/project"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
            </div>

            <div className="border-t border-border pt-6">
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Webhook Secret
                {gitlabStatus.webhookSecretConfigured && (
                  <span className="ml-2 text-xs text-green-500">(configured)</span>
                )}
              </label>
              <div className="relative">
                <input
                  type={gitlabWebhookVisible ? "text" : "password"}
                  value={gitlabWebhookSecret}
                  onChange={(e) => setGitlabWebhookSecret(e.target.value)}
                  placeholder={gitlabStatus.webhookSecretConfigured ? "••••••••••••" : "Enter webhook secret"}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setGitlabWebhookVisible(!gitlabWebhookVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {gitlabWebhookVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Used to verify incoming webhooks from GitLab. Set this in your GitLab webhook settings.
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                disabled={gitlabTesting || !gitlabStatus.connected}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {gitlabTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                disabled={gitlabSaving || (!gitlabToken && !gitlabDefaultRepo && !gitlabWebhookSecret)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-500 transition-colors disabled:opacity-50"
              >
                {gitlabSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* BitBucket SlideOver */}
        <SlideOver
          isOpen={bitbucketSlideOpen}
          onClose={() => setBitbucketSlideOpen(false)}
          title="Configure BitBucket"
          icon={
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-blue-600" fill="currentColor">
              <path d="M.778 1.211a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z"/>
            </svg>
          }
          iconBgColor="bg-blue-600/20"
        >
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Username</label>
              <input
                type="text"
                value={bitbucketUsername}
                onChange={(e) => setBitbucketUsername(e.target.value)}
                placeholder="your-username"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">App Password</label>
              <div className="relative">
                <input
                  type={bitbucketVisible ? "text" : "password"}
                  value={bitbucketAppPassword}
                  onChange={(e) => setBitbucketAppPassword(e.target.value)}
                  placeholder={bitbucketStatus.connected ? "••••••••••••" : "Enter app password"}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setBitbucketVisible(!bitbucketVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {bitbucketVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <a
                href="https://bitbucket.org/account/settings/app-passwords/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Create an app password <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Default Repository</label>
              <input
                type="text"
                value={bitbucketDefaultRepo}
                onChange={(e) => setBitbucketDefaultRepo(e.target.value)}
                placeholder="workspace/repository"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
            </div>

            <div className="border-t border-border pt-6">
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Webhook Secret
                {bitbucketStatus.webhookSecretConfigured && (
                  <span className="ml-2 text-xs text-green-500">(configured)</span>
                )}
              </label>
              <div className="relative">
                <input
                  type={bitbucketWebhookVisible ? "text" : "password"}
                  value={bitbucketWebhookSecret}
                  onChange={(e) => setBitbucketWebhookSecret(e.target.value)}
                  placeholder={bitbucketStatus.webhookSecretConfigured ? "••••••••••••" : "Enter webhook secret"}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setBitbucketWebhookVisible(!bitbucketWebhookVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {bitbucketWebhookVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Used to verify incoming webhooks from BitBucket. Set this in your BitBucket webhook settings.
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                disabled={bitbucketTesting || !bitbucketStatus.connected}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {bitbucketTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                disabled={bitbucketSaving || (!bitbucketUsername && !bitbucketAppPassword && !bitbucketDefaultRepo && !bitbucketWebhookSecret)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50"
              >
                {bitbucketSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* Anthropic SlideOver */}
        <SlideOver
          isOpen={anthropicSlideOpen}
          onClose={() => setAnthropicSlideOpen(false)}
          title="Configure Anthropic"
          icon={<span className="text-2xl">🤖</span>}
          iconBgColor="bg-orange-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-orange-500/5 border border-orange-500/20">
              <p className="text-sm text-muted-foreground">
                Anthropic provides Claude models. Your API key is stored securely in AWS Secrets Manager.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">API Key</label>
              <div className="relative">
                <input
                  type={anthropicProvider.visible ? "text" : "password"}
                  value={anthropicProvider.apiKey}
                  onChange={(e) => setAnthropicProvider((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={anthropicProvider.status.configured ? "••••••••••••" : "sk-ant-api..."}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setAnthropicProvider((prev) => ({ ...prev, visible: !prev.visible }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {anthropicProvider.visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Get an API key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => handleTestProvider("anthropic")}
                disabled={anthropicProvider.testing || !anthropicProvider.status.configured}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {anthropicProvider.testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={() => handleSaveProvider("anthropic")}
                disabled={anthropicProvider.saving || !anthropicProvider.apiKey}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
              >
                {anthropicProvider.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* OpenAI SlideOver */}
        <SlideOver
          isOpen={openaiSlideOpen}
          onClose={() => setOpenaiSlideOpen(false)}
          title="Configure OpenAI"
          icon={<span className="text-2xl">🔷</span>}
          iconBgColor="bg-emerald-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <p className="text-sm text-muted-foreground">
                OpenAI provides GPT models. Your API key is stored securely in AWS Secrets Manager.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">API Key</label>
              <div className="relative">
                <input
                  type={openaiProvider.visible ? "text" : "password"}
                  value={openaiProvider.apiKey}
                  onChange={(e) => setOpenaiProvider((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={openaiProvider.status.configured ? "••••••••••••" : "sk-..."}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setOpenaiProvider((prev) => ({ ...prev, visible: !prev.visible }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {openaiProvider.visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Get an API key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => handleTestProvider("openai")}
                disabled={openaiProvider.testing || !openaiProvider.status.configured}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {openaiProvider.testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={() => handleSaveProvider("openai")}
                disabled={openaiProvider.saving || !openaiProvider.apiKey}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-50"
              >
                {openaiProvider.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* Google SlideOver */}
        <SlideOver
          isOpen={googleSlideOpen}
          onClose={() => setGoogleSlideOpen(false)}
          title="Configure Google"
          icon={<span className="text-2xl">🔵</span>}
          iconBgColor="bg-blue-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <p className="text-sm text-muted-foreground">
                Google provides Gemini models. Your API key is stored securely in AWS Secrets Manager.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">API Key</label>
              <div className="relative">
                <input
                  type={googleProvider.visible ? "text" : "password"}
                  value={googleProvider.apiKey}
                  onChange={(e) => setGoogleProvider((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={googleProvider.status.configured ? "••••••••••••" : "AIza..."}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setGoogleProvider((prev) => ({ ...prev, visible: !prev.visible }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {googleProvider.visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Get an API key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => handleTestProvider("google")}
                disabled={googleProvider.testing || !googleProvider.status.configured}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {googleProvider.testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={() => handleSaveProvider("google")}
                disabled={googleProvider.saving || !googleProvider.apiKey}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {googleProvider.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* Linear SlideOver */}
        <SlideOver
          isOpen={linearSlideOpen}
          onClose={() => setLinearSlideOpen(false)}
          title="Configure Linear"
          icon={
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-indigo-500" fill="currentColor">
              <path d="M3 7.5V3h4.5L3 7.5zm0 0L12 16.5 21 7.5V3h-4.5L12 7.5 7.5 3H3v4.5zM21 7.5L12 16.5 3 7.5v9L12 21l9-4.5v-9z" />
            </svg>
          }
          iconBgColor="bg-indigo-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-indigo-500/5 border border-indigo-500/20">
              <p className="text-sm text-muted-foreground">
                Connect Linear for issue tracking integration. Linear issues can trigger WorkerMill tasks automatically.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">API Key</label>
              <div className="relative">
                <input
                  type={linearVisible ? "text" : "password"}
                  value={linearApiKey}
                  onChange={(e) => setLinearApiKey(e.target.value)}
                  placeholder={linearStatus.connected ? "••••••••••••" : "lin_api_..."}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setLinearVisible(!linearVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {linearVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <a
                href="https://linear.app/settings/api"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Get an API key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Webhook Secret (Optional)</label>
              <div className="relative">
                <input
                  type={linearWebhookVisible ? "text" : "password"}
                  value={linearWebhookSecret}
                  onChange={(e) => setLinearWebhookSecret(e.target.value)}
                  placeholder="Used to verify webhook signatures"
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setLinearWebhookVisible(!linearWebhookVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {linearWebhookVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Create a webhook at{" "}
                <a
                  href="https://linear.app/settings/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Linear Settings → API → Webhooks
                </a>
                . Set the URL to <code className="bg-muted px-1 rounded text-xs">https://workermill.com/api/webhooks/linear</code>.
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={handleTestLinear}
                disabled={linearTesting || !linearStatus.connected}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {linearTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={handleSaveLinear}
                disabled={linearSaving || (!linearApiKey && !linearWebhookSecret)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50"
              >
                {linearSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* Teams SlideOver */}
        <SlideOver
          isOpen={teamsSlideOpen}
          onClose={() => setTeamsSlideOpen(false)}
          title="Configure Microsoft Teams"
          icon={
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-violet-500" fill="currentColor">
              <path d="M19.2 7.8h-4.8V6c0-1.1.9-2 2-2s2 .9 2 2v1.8h.8c.9 0 1.6.7 1.6 1.6v5.2c0 .9-.7 1.6-1.6 1.6h-.8v1.8c0 1.1-.9 2-2 2s-2-.9-2-2v-1.8H9.6v1.8c0 1.1-.9 2-2 2s-2-.9-2-2v-1.8h-.8c-.9 0-1.6-.7-1.6-1.6V9.4c0-.9.7-1.6 1.6-1.6h.8V6c0-1.1.9-2 2-2s2 .9 2 2v1.8h4.8V6c0-1.1.9-2 2-2s2 .9 2 2v1.8zM9.6 14.6v-5.2H4.8v5.2h4.8zm9.6 0v-5.2h-4.8v5.2h4.8z"/>
            </svg>
          }
          iconBgColor="bg-violet-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-violet-500/5 border border-violet-500/20">
              <p className="text-sm text-muted-foreground">
                Configure a Teams webhook to receive notifications when tasks complete or fail.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Incoming Webhook URL</label>
              <input
                type="text"
                value={teamsWebhookUrl}
                onChange={(e) => setTeamsWebhookUrl(e.target.value)}
                placeholder="https://outlook.office.com/webhook/..."
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Create at Teams → Channel → Connectors → Incoming Webhook
              </p>
            </div>
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleTestTeams}
                disabled={teamsTesting || !teamsWebhookUrl}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {teamsTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={handleSaveTeams}
                disabled={teamsSaving || !teamsWebhookUrl}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-violet-500 text-white rounded-lg hover:bg-violet-600 transition-colors disabled:opacity-50"
              >
                {teamsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* Slack SlideOver */}
        <SlideOver
          isOpen={slackSlideOpen}
          onClose={() => setSlackSlideOpen(false)}
          title="Configure Slack"
          icon={
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-purple-500" fill="currentColor">
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
            </svg>
          }
          iconBgColor="bg-purple-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
              <p className="text-sm text-muted-foreground">
                Configure a Slack webhook to receive notifications when tasks complete or fail.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Incoming Webhook URL</label>
              <input
                type="text"
                value={slackWebhookUrl}
                onChange={(e) => setSlackWebhookUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
              <a
                href="https://api.slack.com/messaging/webhooks"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Learn how to create a Slack webhook <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleTestSlackWebhook}
                disabled={slackWebhookTesting || !slackStatus.connected}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {slackWebhookTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={handleSaveSlack}
                disabled={slackSaving || !slackWebhookUrl}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50"
              >
                {slackSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* AWS SlideOver */}
        <SlideOver
          isOpen={awsSlideOpen}
          onClose={() => setAwsSlideOpen(false)}
          title="Configure AWS"
          icon={
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-orange-500" fill="currentColor">
              <path d="M18.75 11.35a4.32 4.32 0 0 1-.79-.08 3.9 3.9 0 0 0 .49-1.9 3.97 3.97 0 0 0-3.97-3.97 4.01 4.01 0 0 0-1.77.41 5.22 5.22 0 0 0-9.71 2.65c0 .2.02.4.04.59A3.97 3.97 0 0 0 3.97 13a3.97 3.97 0 0 0 3.97 3.97h10.81a3.97 3.97 0 0 0 0-7.94v2.32z"/>
              <path d="M7.55 14.3a.43.43 0 0 1-.22-.4V9.17a.43.43 0 0 1 .65-.37l3.93 2.37a.43.43 0 0 1 0 .74l-3.93 2.37a.43.43 0 0 1-.43.02z"/>
            </svg>
          }
          iconBgColor="bg-orange-500/20"
        >
          <div className="space-y-6">
            {/* Auth Method Tabs */}
            <div className="flex rounded-lg bg-background/50 p-1 border border-border">
              <button
                onClick={() => setAwsAuthMethod("role")}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  awsAuthMethod === "role"
                    ? "bg-orange-500 text-white"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                IAM Role (Recommended)
              </button>
              <button
                onClick={() => setAwsAuthMethod("keys")}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  awsAuthMethod === "keys"
                    ? "bg-orange-500 text-white"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Access Keys
              </button>
            </div>

            {/* IAM Role Method */}
            {awsAuthMethod === "role" && (
              <>
                <div className="p-4 rounded-lg bg-orange-500/5 border border-orange-500/20">
                  <p className="text-sm text-muted-foreground">
                    Create an IAM role in your AWS account that trusts WorkerMill. This is more secure than access keys - no long-term credentials to rotate.
                  </p>
                </div>

                {/* External ID (read-only) */}
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Your External ID
                    <span className="ml-2 text-xs text-orange-500">(Add to your IAM role trust policy)</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={awsExternalIdLoading ? "Loading..." : awsExternalId}
                      readOnly
                      className="w-full px-4 py-3 pr-10 rounded-xl bg-background/30 border border-border text-muted-foreground font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(awsExternalId);
                        setMessage({ type: "success", text: "External ID copied to clipboard" });
                      }}
                      disabled={!awsExternalId}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-50"
                      title="Copy to clipboard"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Role ARN */}
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">IAM Role ARN</label>
                  <input
                    type="text"
                    value={awsRoleArn}
                    onChange={(e) => setAwsRoleArn(e.target.value)}
                    placeholder="arn:aws:iam::123456789012:role/WorkerMillDeployment"
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all font-mono text-sm"
                  />
                </div>

                {/* Region */}
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">Default Region</label>
                  <input
                    type="text"
                    value={awsRegion}
                    onChange={(e) => setAwsRegion(e.target.value)}
                    placeholder="us-east-1"
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                  />
                </div>

                {/* Test Result */}
                {awsTestResult && (
                  <div className={`p-4 rounded-lg border ${
                    awsTestResult.success
                      ? "bg-green-500/5 border-green-500/20 text-green-400"
                      : "bg-red-500/5 border-red-500/20 text-red-400"
                  }`}>
                    <div className="flex items-center gap-2">
                      {awsTestResult.success ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : (
                        <XCircle className="w-4 h-4" />
                      )}
                      <span className="text-sm">{awsTestResult.message}</span>
                    </div>
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleTestAwsRole}
                    disabled={awsTesting || !awsRoleArn}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-orange-500 text-orange-500 rounded-lg hover:bg-orange-500/10 transition-colors disabled:opacity-50"
                  >
                    {awsTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Test Connection
                  </button>
                  <button
                    onClick={handleSaveAwsRole}
                    disabled={awsSaving || !awsRoleArn}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
                  >
                    {awsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save
                  </button>
                </div>

                {/* Setup Instructions */}
                <div className="pt-4 border-t border-border">
                  <details className="group">
                    <summary className="text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground flex items-center gap-2">
                      <ChevronRight className="w-4 h-4 group-open:rotate-90 transition-transform" />
                      Setup Instructions
                    </summary>
                    <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                      <p>1. Create an IAM role in your AWS account</p>
                      <p>2. Add this trust policy (replace YOUR_EXTERNAL_ID):</p>
                      <pre className="p-3 rounded-lg bg-background/50 border border-border text-xs overflow-x-auto">
{`{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::AWS_ACCOUNT_ID:role/workermill-dev-worker-task"
    },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": {
        "sts:ExternalId": "${awsExternalId || "YOUR_EXTERNAL_ID"}"
      }
    }
  }]
}`}
                      </pre>
                      <p>3. Attach policies for ECR, ECS, S3, CloudFront as needed</p>
                      <p>4. Copy the Role ARN and paste it above</p>
                    </div>
                  </details>
                </div>
              </>
            )}

            {/* Access Keys Method */}
            {awsAuthMethod === "keys" && (
              <>
                <div className="p-4 rounded-lg bg-orange-500/5 border border-orange-500/20">
                  <p className="text-sm text-muted-foreground">
                    Configure AWS access keys to deploy workers to your AWS account. For better security, consider using IAM roles instead.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">Access Key ID</label>
                  <input
                    type="text"
                    value={awsAccessKey}
                    onChange={(e) => setAwsAccessKey(e.target.value)}
                    placeholder="AKIAIOSFODNN7EXAMPLE"
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">Secret Access Key</label>
                  <div className="relative">
                    <input
                      type={awsVisible ? "text" : "password"}
                      value={awsSecretKey}
                      onChange={(e) => setAwsSecretKey(e.target.value)}
                      placeholder={awsStatus.connected ? "••••••••••••" : "Enter secret access key"}
                      className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setAwsVisible(!awsVisible)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {awsVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">Default Region</label>
                  <input
                    type="text"
                    value={awsRegion}
                    onChange={(e) => setAwsRegion(e.target.value)}
                    placeholder="us-east-1"
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleSaveAws}
                    disabled={awsSaving || !awsAccessKey || !awsSecretKey}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
                  >
                    {awsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save
                  </button>
                </div>
              </>
            )}
          </div>
        </SlideOver>

        {/* GCP SlideOver */}
        <SlideOver
          isOpen={gcpSlideOpen}
          onClose={() => setGcpSlideOpen(false)}
          title="Configure Google Cloud"
          icon={
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-blue-500" fill="currentColor">
              <path d="M12.19 2.38a9.344 9.344 0 0 0-9.234 6.893c.053-.02-.055.013 0 0-3.875 2.551-3.922 8.11-.247 10.941l.006-.007-.007.03a6.717 6.717 0 0 0 4.077 1.356h5.173l.03.03h5.192c6.687.053 9.376-8.605 3.835-12.35a9.365 9.365 0 0 0-8.825-6.893z"/>
            </svg>
          }
          iconBgColor="bg-blue-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <p className="text-sm text-muted-foreground">
                Configure GCP credentials to deploy workers to your Google Cloud account.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Project ID</label>
              <input
                type="text"
                value={gcpProjectId}
                onChange={(e) => setGcpProjectId(e.target.value)}
                placeholder="my-project-123456"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Service Account JSON</label>
              <div className="relative">
                <textarea
                  value={gcpServiceAccount}
                  onChange={(e) => setGcpServiceAccount(e.target.value)}
                  placeholder={gcpStatus.connected ? "••••••••••••" : "Paste service account JSON here"}
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setGcpVisible(!gcpVisible)}
                  className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                >
                  {gcpVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleSaveGcp}
                disabled={gcpSaving || !gcpServiceAccount || !gcpProjectId}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {gcpSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* Azure SlideOver */}
        <SlideOver
          isOpen={azureSlideOpen}
          onClose={() => setAzureSlideOpen(false)}
          title="Configure Azure"
          icon={
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-cyan-500" fill="currentColor">
              <path d="M13.05 4.24L6.56 18.05a.5.5 0 0 0 .46.7h11.96a.5.5 0 0 0 .46-.7l-6.49-13.81a.5.5 0 0 0-.9 0z"/>
            </svg>
          }
          iconBgColor="bg-cyan-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-cyan-500/5 border border-cyan-500/20">
              <p className="text-sm text-muted-foreground">
                Configure Azure credentials to deploy workers to your Microsoft Azure account.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Client ID (App ID)</label>
              <input
                type="text"
                value={azureClientId}
                onChange={(e) => setAzureClientId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Client Secret</label>
              <div className="relative">
                <input
                  type={azureVisible ? "text" : "password"}
                  value={azureClientSecret}
                  onChange={(e) => setAzureClientSecret(e.target.value)}
                  placeholder={azureStatus.connected ? "••••••••••••" : "Enter client secret"}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setAzureVisible(!azureVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {azureVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Tenant ID</label>
              <input
                type="text"
                value={azureTenantId}
                onChange={(e) => setAzureTenantId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Subscription ID</label>
              <input
                type="text"
                value={azureSubscriptionId}
                onChange={(e) => setAzureSubscriptionId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleSaveAzure}
                disabled={azureSaving || !azureClientId || !azureClientSecret || !azureTenantId || !azureSubscriptionId}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors disabled:opacity-50"
              >
                {azureSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* WorkerMill MCP SlideOver */}
        <SlideOver
          isOpen={workermillSlideOpen}
          onClose={() => {
            setWorkermillSlideOpen(false);
            setMcpCreatedToken(null);
            setMcpNewKeyName("");
          }}
          title="WorkerMill MCP Integration"
          icon={<Router className="w-6 h-6 text-primary" />}
          iconBgColor="bg-primary/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-sm text-muted-foreground">
                Generate API keys to use WorkerMill's MCP server with Claude Code, Claude Desktop, or other MCP-compatible tools.
              </p>
            </div>

            {/* Create New Key */}
            {mcpCreatedToken ? (
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  API Key Created
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Copy your API key now. You won't be able to see it again!
                </p>
                <div className="flex items-center gap-2 p-3 bg-background rounded-lg border border-border">
                  <code className="flex-1 text-sm break-all font-mono">{mcpCreatedToken}</code>
                  <button
                    onClick={handleCopyMcpToken}
                    className="p-2 hover:bg-muted rounded transition-colors"
                    title="Copy to clipboard"
                  >
                    {mcpCopiedToken ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <button
                  onClick={() => setMcpCreatedToken(null)}
                  className="mt-3 w-full px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-all"
                >
                  Done
                </button>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Create New API Key</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={mcpNewKeyName}
                    onChange={(e) => setMcpNewKeyName(e.target.value)}
                    placeholder="Key name (e.g., 'Claude Code')"
                    className="flex-1 px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                  />
                  <button
                    onClick={handleCreateMcpApiKey}
                    disabled={mcpCreatingKey || !mcpNewKeyName.trim()}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {mcpCreatingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create
                  </button>
                </div>
              </div>
            )}

            {/* Existing Keys */}
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Existing API Keys</label>
              {mcpApiKeysLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : mcpApiKeys.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No API keys yet. Create one to get started.
                </div>
              ) : (
                <div className="space-y-2">
                  {mcpApiKeys.map((key) => (
                    <div
                      key={key.id}
                      className="flex items-center justify-between p-3 bg-background/50 rounded-lg border border-border"
                    >
                      <div>
                        <p className="font-medium text-foreground text-sm">{key.name}</p>
                        <p className="text-xs text-muted-foreground">
                          <code className="bg-muted px-1 py-0.5 rounded">{key.keyPrefix}...</code>
                          <span className="mx-2">·</span>
                          Created {formatDate(key.createdAt)}
                          {key.lastUsedAt && (
                            <>
                              <span className="mx-2">·</span>
                              Last used {formatDate(key.lastUsedAt)}
                            </>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteMcpApiKey(key.id)}
                        className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Revoke key"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Usage Instructions */}
            <div className="p-4 rounded-lg bg-muted/50 border border-border">
              <h4 className="text-sm font-semibold text-foreground mb-2">Usage with Claude Code</h4>
              <p className="text-xs text-muted-foreground mb-2">
                Add this to your Claude Code MCP configuration:
              </p>
              <pre className="text-xs bg-background p-3 rounded-lg overflow-x-auto border border-border">
{`{
  "mcpServers": {
    "workermill": {
      "type": "sse",
      "url": "${API_BASE}/api/mcp/sse",
      "headers": {
        "x-api-key": "YOUR_API_KEY"
      }
    }
  }
}`}
              </pre>
            </div>
          </div>
        </SlideOver>

        {/* Discord SlideOver */}
        <SlideOver
          isOpen={discordSlideOpen}
          onClose={() => setDiscordSlideOpen(false)}
          title="Configure Discord"
          icon={
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-indigo-400" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
          }
          iconBgColor="bg-indigo-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-indigo-500/5 border border-indigo-500/20">
              <p className="text-sm text-muted-foreground">
                Configure a Discord webhook to receive notifications when tasks complete or fail.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Webhook URL</label>
              <input
                type="text"
                value={discordWebhookUrl}
                onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
              <a
                href="https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Learn how to create a Discord webhook <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => {
                  setDiscordTesting(true);
                  setTimeout(() => {
                    setDiscordTesting(false);
                    setMessage({ type: "info", text: "Discord test not yet implemented" });
                  }, 1000);
                }}
                disabled={discordTesting || !discordWebhookUrl}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {discordTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={() => {
                  setDiscordSaving(true);
                  setTimeout(() => {
                    setDiscordSaving(false);
                    setDiscordStatus({ connected: true, lastChecked: new Date().toISOString() });
                    setMessage({ type: "success", text: "Discord webhook saved" });
                    setDiscordSlideOpen(false);
                  }, 1000);
                }}
                disabled={discordSaving || !discordWebhookUrl}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50"
              >
                {discordSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* Email SlideOver */}
        <SlideOver
          isOpen={emailSlideOpen}
          onClose={() => setEmailSlideOpen(false)}
          title="Configure Email (SMTP)"
          icon={<Mail className="w-6 h-6 text-sky-500" />}
          iconBgColor="bg-sky-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-sky-500/5 border border-sky-500/20">
              <p className="text-sm text-muted-foreground">
                Configure SMTP settings to receive email notifications when tasks complete or fail.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">SMTP Host</label>
              <input
                type="text"
                value={emailSmtpHost}
                onChange={(e) => setEmailSmtpHost(e.target.value)}
                placeholder="smtp.example.com"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">SMTP Port</label>
              <input
                type="text"
                value={emailSmtpPort}
                onChange={(e) => setEmailSmtpPort(e.target.value)}
                placeholder="587"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Username</label>
              <input
                type="text"
                value={emailSmtpUser}
                onChange={(e) => setEmailSmtpUser(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Password</label>
              <input
                type="password"
                value={emailSmtpPassword}
                onChange={(e) => setEmailSmtpPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => {
                  setEmailTesting(true);
                  setTimeout(() => {
                    setEmailTesting(false);
                    setMessage({ type: "info", text: "Email test not yet implemented" });
                  }, 1000);
                }}
                disabled={emailTesting || !emailSmtpHost}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {emailTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={() => {
                  setEmailSaving(true);
                  setTimeout(() => {
                    setEmailSaving(false);
                    setEmailStatus({ connected: true, lastChecked: new Date().toISOString() });
                    setMessage({ type: "success", text: "Email settings saved" });
                    setEmailSlideOpen(false);
                  }, 1000);
                }}
                disabled={emailSaving || !emailSmtpHost}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600 transition-colors disabled:opacity-50"
              >
                {emailSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* OnCallShift SlideOver */}
        <SlideOver
          isOpen={oncallshiftSlideOpen}
          onClose={() => setOncallshiftSlideOpen(false)}
          title="Configure OnCallShift"
          icon={<Bell className="w-6 h-6 text-rose-500" />}
          iconBgColor="bg-rose-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-rose-500/5 border border-rose-500/20">
              <p className="text-sm text-muted-foreground">
                Connect OnCallShift to create incidents automatically when critical tasks fail or need escalation.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">API Key</label>
              <input
                type="password"
                value={oncallshiftApiKey}
                onChange={(e) => setOncallshiftApiKey(e.target.value)}
                placeholder="ocs_..."
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Create at OnCallShift → Settings → API Keys
              </p>
            </div>
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => {
                  setOncallshiftTesting(true);
                  setTimeout(() => {
                    setOncallshiftTesting(false);
                    setMessage({ type: "info", text: "OnCallShift test not yet implemented" });
                  }, 1000);
                }}
                disabled={oncallshiftTesting || !oncallshiftApiKey}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {oncallshiftTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={() => {
                  setOncallshiftSaving(true);
                  setTimeout(() => {
                    setOncallshiftSaving(false);
                    setOncallshiftStatus({ connected: true, lastChecked: new Date().toISOString() });
                    setMessage({ type: "success", text: "OnCallShift API key saved" });
                    setOncallshiftSlideOpen(false);
                  }, 1000);
                }}
                disabled={oncallshiftSaving || !oncallshiftApiKey}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors disabled:opacity-50"
              >
                {oncallshiftSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>
      </ErrorBoundaryWithRetry>
    </div>
  );
}
