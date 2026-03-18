import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
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
  Users,
  AlertTriangle,
  UserPlus,
  Trash2,
  Send,
  X,
  Server,
  Plus,
  Link as LinkIcon,
  RotateCcw,
  Copy,
  ChevronRight,
  Bell,
  Shield,
  Github,
  Router,
} from "lucide-react";
import { useAuthStore } from "../../store/auth-store";
import { organizationsAPI, type UserOrganization } from "../../lib/api-client";
import {
  ErrorBoundaryWithRetry,
  SettingsErrorFallback,
} from "../../components/ErrorBoundary";
import { SlideOver } from "../../components/ui/SlideOver";
import type {
  IntegrationStatus,
  AIProviderState,
  EmailPreferences,
  Settings,
  ValidationErrors,
  TeamMember,
  PendingInvite,
  UsageData,
  SettingsCategory,
  NavItem,
  ExternalLinkItem,
} from "./types";
import { API_BASE, MODEL_OPTIONS, PROVIDER_OPTIONS } from "./types";
import { RemoteAgentSection } from "./RemoteAgentSection";
import { GeneralSection } from "./GeneralSection";
import { TeamSection } from "./TeamSection";
import { AIWorkersSection } from "./AIWorkersSection";
import { QualitySection } from "./QualitySection";
import { IntegrationsSection } from "./IntegrationsSection";
import { BillingSection } from "./BillingSection";
import { NotificationsSection } from "./NotificationsSection";
import { DataSection } from "./DataSection";

// Navigation items
const NAV_ITEMS: NavItem[] = [
  { id: "general", label: "General", icon: <Building className="w-5 h-5" /> },
  { id: "team", label: "Team", icon: <Users className="w-5 h-5" /> },
  { id: "ai-workers", label: "AI Workers", icon: <Cpu className="w-5 h-5" /> },
  { id: "quality", label: "Quality Gates", icon: <Shield className="w-5 h-5" /> },
  { id: "integrations", label: "Integrations", icon: <LinkIcon className="w-5 h-5" /> },
  { id: "remote-agent", label: "Remote Agent", icon: <Server className="w-5 h-5" /> },
  { id: "billing", label: "Billing", icon: <DollarSign className="w-5 h-5" /> },
  { id: "notifications", label: "Notifications", icon: <Bell className="w-5 h-5" /> },
  { id: "data", label: "Data & Display", icon: <Database className="w-5 h-5" /> },
];


export default function Settings() {
  const tokens = useAuthStore((state) => state.tokens);
  const organization = useAuthStore((state) => state.organization);
  const currentUser = useAuthStore((state) => state.user);
  const [searchParams] = useSearchParams();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(() => {
    const tab = searchParams.get("tab");
    const validTabs = NAV_ITEMS.map((n) => n.id);
    return tab && validTabs.includes(tab as SettingsCategory)
      ? (tab as SettingsCategory)
      : "general";
  });

  // Sync activeCategory when URL ?tab= changes (e.g. navigating from checklist)
  useEffect(() => {
    const tab = searchParams.get("tab");
    const validTabs = NAV_ITEMS.map((n) => n.id);
    if (tab && validTabs.includes(tab as SettingsCategory)) {
      setActiveCategory(tab as SettingsCategory);
    }
  }, [searchParams]);

  const externalLinks: ExternalLinkItem[] = organization?.plan === 'enterprise'
    ? [{ label: "Compliance Center", icon: <Shield className="w-5 h-5" />, href: "/compliance" }]
    : [];

  // Settings state
  const [settings, setSettings] = useState<Settings>({
    logRetentionDays: 7,
    taskRetentionDays: 7,
    maxConcurrentWorkers: 1,
    maxParallelExperts: 3,
    ralphMaxStories: 10,
    defaultMaxRetries: 3,
    taskCooldownSeconds: 0,
    defaultWorkerModel: "claude-sonnet-4-6",
    defaultWorkerPersona: "backend_developer",
    aiGuidelines: null,
    primaryProvider: "anthropic",
    providerRouting: {},
    ollamaBaseUrl: null,
    ollamaContextWindow: 65536,
    managerProvider: "anthropic",
    managerModelId: "claude-opus-4-6",
    maxReviewRevisions: 3,
    maxPerStoryRevisions: 0,
    planningAgentProvider: "anthropic",
    planningAgentModel: "claude-opus-4-6",
    planningMode: "simplified",
    prdPlanningMode: "simplified",
    criticApprovalThreshold: 85,
    maxTargetFiles: 15,
    storyCalibrationMultiplier: 0.4,
    costAlertThresholdUsd: null,
    dailyBudgetLimitUsd: null,
    weeklyBudgetLimitUsd: null,
    monthlyBudgetLimitUsd: null,
    perTaskCostCeilingUsd: null,
    scmProvider: "github",
    scmBaseUrl: null,
    issueTrackerProvider: "internal",
    completedTaskDisplayMinutes: 10,
    intermediateTaskDisplayMinutes: 60,
    dryRunVisibilityMinutes: 1,
    emailNotificationsEnabled: true,
    emailFromAddress: null,
    defaultEmailPreferences: {
      taskCompleted: true,
      taskFailed: true,
      costAlerts: false,
      prCreated: false,
      frequency: "immediate",
    },
    autoReviewEnabled: false,
    autoDeployEnabled: false,
    autoImproveEnabled: false,
    autoSkillExtraction: true,
    prdAutoRun: true,
    remoteAgentOnly: false,
    warmPoolSize: 0,
    warmPoolHoursStart: 9,
    warmPoolHoursEnd: 18,
    warmPoolTimezone: "America/New_York",
    // Quality Gate defaults
    qualityGateEnabled: false,
    minQualityScore: null,
    minTestCoveragePercent: null,
    maxSecurityHighVulns: null,
    blockOnTypeErrors: false,
    blockOnTestFailures: true,
    blockOnLintErrors: false,
    blockOnE2EFailures: true,
    sonarqubeUrl: null,
    sonarqubeToken: null,
    coderabbitEnabled: false,
    coderabbitApiKey: null,
    deepsourceEnabled: false,
    deepsourceToken: null,
    qualityWebhookUrl: null,
    qualityWebhookSecret: null,
    autoFixEnabled: false,
    autoFixMaxIterations: 3,
    // Resilience defaults
    blockerMaxAutoRetries: 3,
    blockerAutoRetryEnabled: true,
    maxFixRetries: 3,
    blockerWaitTimeoutMinutes: 20,
    pushAfterCommit: true,
    gracefulShutdownEnabled: true,
    selfReviewEnabled: false,
    // Repository list
    repositories: [],
    // Codebase RAG defaults
    codebaseIndexingEnabled: false,
    codebaseMaxFilesPerRepo: 500,
    codebaseMaxFileSizeKb: 100,
    codebaseExcludePatterns: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "*.min.js",
      "*.min.css",
    ],
    codebaseIncludeLanguages: [
      "typescript",
      "javascript",
      "python",
      "go",
      "rust",
      "java",
    ],
    codebaseAutoIndexOnTask: true,
    codebaseMaxRetrievalChunks: 10,
    // Spec Engineering defaults
    maxAgentTurns: null,
    specMinQualityScore: 0,
    specRequiredSections: null,
  });
  const [originalSettings, setOriginalSettings] = useState<Settings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Reset counters state
  const [resetCountersLoading, setResetCountersLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Organization identity
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

  // Organization memberships (multi-org support)
  const [userOrganizations, setUserOrganizations] = useState<UserOrganization[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);

  // Webhook URLs (computed from slug)
  const webhookBaseUrl = "https://workermill.com/api/webhooks";
  const getWebhookUrl = (integration: string) =>
    orgSlug ? `${webhookBaseUrl}/${orgSlug}/${integration}` : null;

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
  const [githubReviewerToken, setGithubReviewerToken] = useState("");
  const [githubDefaultRepo, setGithubDefaultRepo] = useState("");
  const [githubWebhookSecret, setGithubWebhookSecret] = useState("");
  const [githubStatus, setGithubStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [githubVisible, setGithubVisible] = useState(false);
  const [githubReviewerVisible, setGithubReviewerVisible] = useState(false);
  const [githubWebhookVisible, setGithubWebhookVisible] = useState(false);
  const [githubTesting, setGithubTesting] = useState(false);
  const [githubSaving, setGithubSaving] = useState(false);

  // GitLab integration state
  const [gitlabToken, setGitlabToken] = useState("");
  const [gitlabWebhookSecret, setGitlabWebhookSecret] = useState("");
  const [gitlabDefaultRepo, setGitlabDefaultRepo] = useState("");
  const [gitlabStatus, setGitlabStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [gitlabVisible, setGitlabVisible] = useState(false);
  const [gitlabWebhookVisible, setGitlabWebhookVisible] = useState(false);
  const [gitlabTesting, setGitlabTesting] = useState(false);
  const [gitlabSaving, setGitlabSaving] = useState(false);

  // BitBucket integration state
  const [bitbucketUsername, setBitbucketUsername] = useState("");
  const [bitbucketAppPassword, setBitbucketAppPassword] = useState("");
  const [bitbucketWebhookSecret, setBitbucketWebhookSecret] = useState("");
  const [bitbucketDefaultRepo, setBitbucketDefaultRepo] = useState("");
  const [bitbucketStatus, setBitbucketStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [bitbucketVisible, setBitbucketVisible] = useState(false);
  const [bitbucketWebhookVisible, setBitbucketWebhookVisible] = useState(false);
  const [bitbucketTesting, setBitbucketTesting] = useState(false);
  const [bitbucketSaving, setBitbucketSaving] = useState(false);

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
  const [workerTaskRoleArn, setWorkerTaskRoleArn] = useState("");
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
   
  const [ollamaSlideOpen, setOllamaSlideOpen] = useState(false);
  const [awsSlideOpen, setAwsSlideOpen] = useState(false);
  const [gcpSlideOpen, setGcpSlideOpen] = useState(false);
  const [azureSlideOpen, setAzureSlideOpen] = useState(false);

  // Remote Agents state
  const [remoteAgents, setRemoteAgents] = useState<{ agentId: string; hostname: string | null; platform: string | null; nodeVersion: string | null; dockerVersion: string | null; claudeVersion: string | null; maxWorkers: number; activeTasks: number; status: string; lastHeartbeatAt: string; createdAt: string }[]>([]);
  const [remoteAgentsLoading, setRemoteAgentsLoading] = useState(false);

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
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null);

  // Member management state
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [updatingMemberRole, setUpdatingMemberRole] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const [showRemoveConfirmModal, setShowRemoveConfirmModal] = useState(false);

  // Usage state
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);

  // Slack integration state
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [slackStatus, setSlackStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [slackSlideOpen, setSlackSlideOpen] = useState(false);
  const [slackSaving, setSlackSaving] = useState(false);
  const [slackWebhookTesting, setSlackWebhookTesting] = useState(false);

  // Test email state
  const [testEmailLoading, setTestEmailLoading] = useState(false);
  const [testEmailMessage, setTestEmailMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // User email preferences state (personal notification settings)
  const [userEmailPreferences, setUserEmailPreferences] = useState<EmailPreferences>({
    taskCompleted: true,
    taskFailed: true,
    costAlerts: false,
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
  const [openrouterProvider, setOpenrouterProvider] = useState<AIProviderState>({ ...defaultProviderState });
  const [groqProvider, setGroqProvider] = useState<AIProviderState>({ ...defaultProviderState });
  const [deepseekProvider, setDeepseekProvider] = useState<AIProviderState>({ ...defaultProviderState });
  const [mistralProvider, setMistralProvider] = useState<AIProviderState>({ ...defaultProviderState });
  const [xaiProvider, setXaiProvider] = useState<AIProviderState>({ ...defaultProviderState });
  const [azureProvider, setAzureProvider] = useState<AIProviderState>({ ...defaultProviderState });

  // AI Provider slide-over states
  const [anthropicSlideOpen, setAnthropicSlideOpen] = useState(false);
  const [openaiSlideOpen, setOpenaiSlideOpen] = useState(false);
  const [googleSlideOpen, setGoogleSlideOpen] = useState(false);
  const [openrouterSlideOpen, setOpenrouterSlideOpen] = useState(false);
  const [groqSlideOpen, setGroqSlideOpen] = useState(false);
  const [deepseekSlideOpen, setDeepseekSlideOpen] = useState(false);
  const [mistralSlideOpen, setMistralSlideOpen] = useState(false);
  const [xaiSlideOpen, setXaiSlideOpen] = useState(false);
  const [azureOpenaiSlideOpen, setAzureOpenaiSlideOpen] = useState(false);

  // WorkerMill MCP integration state
  const [workermillSlideOpen, setWorkermillSlideOpen] = useState(false);
  const [mcpApiKeys, setMcpApiKeys] = useState<{ id: string; name: string; keyPrefix: string; createdAt: string; lastUsedAt: string | null }[]>([]);
  const [mcpApiKeysLoading, setMcpApiKeysLoading] = useState(false);
  const [mcpNewKeyName, setMcpNewKeyName] = useState("");
  const [mcpCreatedToken, setMcpCreatedToken] = useState<string | null>(null);
  const [mcpCopiedToken, setMcpCopiedToken] = useState(false);
  const [mcpCreatingKey, setMcpCreatingKey] = useState(false);

  const currentModels = MODEL_OPTIONS[settings.primaryProvider] || MODEL_OPTIONS.anthropic;

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
        logRetentionDays: data.logRetentionDays ?? 7,
        taskRetentionDays: data.taskRetentionDays ?? 7,
        maxConcurrentWorkers: data.maxConcurrentWorkers ?? 1,
        maxParallelExperts: data.maxParallelExperts ?? 3,
        ralphMaxStories: data.ralphMaxStories ?? 10,
        defaultMaxRetries: Math.min(data.defaultMaxRetries ?? 3, 5),
        taskCooldownSeconds: data.taskCooldownSeconds ?? 0,
        defaultWorkerModel: data.defaultWorkerModel || "claude-sonnet-4-6",
        defaultWorkerPersona: data.defaultWorkerPersona || "backend_developer",
        aiGuidelines: data.aiGuidelines ?? null,
        primaryProvider: data.primaryProvider || "anthropic",
        providerRouting: data.providerRouting ?? {},
        ollamaBaseUrl: data.ollamaBaseUrl ?? null,
        ollamaContextWindow: data.ollamaContextWindow ?? 65536,
        managerProvider: data.managerProvider,
        managerModelId: data.managerModelId || "",
        maxReviewRevisions: data.maxReviewRevisions,
        maxPerStoryRevisions: data.maxPerStoryRevisions,
        planningAgentProvider: data.planningAgentProvider || "anthropic",
        planningAgentModel: data.planningAgentModel || "claude-opus-4-6",
        planningMode: data.planningMode || "simplified",
        prdPlanningMode: data.prdPlanningMode || data.planningMode || "simplified",
        criticApprovalThreshold: data.criticApprovalThreshold ?? 85,
        maxTargetFiles: data.maxTargetFiles ?? 15,
        storyCalibrationMultiplier: data.storyCalibrationMultiplier ?? 0.4,
        costAlertThresholdUsd: data.costAlertThresholdUsd ?? null,
        dailyBudgetLimitUsd: data.dailyBudgetLimitUsd ?? null,
        weeklyBudgetLimitUsd: data.weeklyBudgetLimitUsd ?? null,
        monthlyBudgetLimitUsd: data.monthlyBudgetLimitUsd ?? null,
        perTaskCostCeilingUsd: data.perTaskCostCeilingUsd ?? null,
        completedTaskDisplayMinutes: data.completedTaskDisplayMinutes ?? 10,
        intermediateTaskDisplayMinutes: data.intermediateTaskDisplayMinutes ?? 60,
        dryRunVisibilityMinutes: data.dryRunVisibilityMinutes ?? 1,
        emailNotificationsEnabled: data.emailNotificationsEnabled,
        emailFromAddress: data.emailFromAddress ?? null,
        defaultEmailPreferences: data.defaultEmailPreferences ?? {
          taskCompleted: true,
          taskFailed: true,
          costAlerts: false,
          prCreated: false,
          frequency: "immediate",
        },
        scmProvider: data.scmProvider || "github",
        scmBaseUrl: data.scmBaseUrl ?? null,
        issueTrackerProvider: data.issueTrackerProvider || "internal",
        autoReviewEnabled: data.autoReviewEnabled,
        autoDeployEnabled: data.autoDeployEnabled,
        autoImproveEnabled: data.autoImproveEnabled,
        autoSkillExtraction: data.autoSkillExtraction,
        prdAutoRun: data.prdAutoRun,
        remoteAgentOnly: data.remoteAgentOnly,
        warmPoolSize: data.warmPoolSize ?? 0,
        warmPoolHoursStart: data.warmPoolHoursStart ?? 9,
        warmPoolHoursEnd: data.warmPoolHoursEnd ?? 18,
        warmPoolTimezone: data.warmPoolTimezone || "America/New_York",
        // Quality Gate settings
        qualityGateEnabled: data.qualityGateEnabled,
        minQualityScore: data.minQualityScore ?? null,
        minTestCoveragePercent: data.minTestCoveragePercent ?? null,
        maxSecurityHighVulns: data.maxSecurityHighVulns ?? null,
        blockOnTypeErrors: data.blockOnTypeErrors,
        blockOnTestFailures: data.blockOnTestFailures,
        blockOnLintErrors: data.blockOnLintErrors,
        blockOnE2EFailures: data.blockOnE2EFailures,
        sonarqubeUrl: data.sonarqubeUrl ?? null,
        sonarqubeToken: data.sonarqubeToken ?? null,
        coderabbitEnabled: data.coderabbitEnabled,
        coderabbitApiKey: data.coderabbitApiKey ?? null,
        deepsourceEnabled: data.deepsourceEnabled,
        deepsourceToken: data.deepsourceToken ?? null,
        qualityWebhookUrl: data.qualityWebhookUrl ?? null,
        qualityWebhookSecret: data.qualityWebhookSecret ?? null,
        autoFixEnabled: data.autoFixEnabled,
        autoFixMaxIterations: data.autoFixMaxIterations ?? 3,
        // Resilience settings
        blockerMaxAutoRetries: data.blockerMaxAutoRetries,
        blockerAutoRetryEnabled: data.blockerAutoRetryEnabled,
        maxFixRetries: data.maxFixRetries ?? 3,
        blockerWaitTimeoutMinutes: data.blockerWaitTimeoutMinutes ?? 20,
        pushAfterCommit: data.pushAfterCommit,
        gracefulShutdownEnabled: data.gracefulShutdownEnabled,
        selfReviewEnabled: data.selfReviewEnabled,
        // Repository list
        repositories: data.repositories ?? [],
        // Codebase RAG settings
        codebaseIndexingEnabled: data.codebaseIndexingEnabled,
        codebaseMaxFilesPerRepo: data.codebaseMaxFilesPerRepo ?? 500,
        codebaseMaxFileSizeKb: data.codebaseMaxFileSizeKb ?? 100,
        codebaseExcludePatterns: data.codebaseExcludePatterns ?? [
          "node_modules/**",
          "dist/**",
          "build/**",
          "*.min.js",
          "*.min.css",
        ],
        codebaseIncludeLanguages: data.codebaseIncludeLanguages ?? [
          "typescript",
          "javascript",
          "python",
          "go",
          "rust",
          "java",
        ],
        codebaseAutoIndexOnTask: data.codebaseAutoIndexOnTask,
        codebaseMaxRetrievalChunks: data.codebaseMaxRetrievalChunks ?? 10,
        // Spec Engineering settings
        maxAgentTurns: data.maxAgentTurns ?? null,
        specMinQualityScore: data.specMinQualityScore ?? 0,
        specRequiredSections: data.specRequiredSections ?? null,
      };
      setSettings(loadedSettings);
      setOriginalSettings(loadedSettings);

      // Set organization identity
      setOrgSlug(data.slug || null);
      setOrgName(data.name || null);
    } catch (err) {
      console.error("Failed to fetch settings:", err);
      setSettingsError("Failed to load settings. Using default values.");
    } finally {
      setSettingsLoading(false);
    }
  }, [tokens?.accessToken]);

  // Fetch user's organization memberships
  const fetchUserOrganizations = useCallback(async () => {
    setOrgsLoading(true);
    try {
      const orgs = await organizationsAPI.list();
      setUserOrganizations(orgs);
    } catch (error) {
      console.error("Failed to fetch organizations:", error);
    } finally {
      setOrgsLoading(false);
    }
  }, []);

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
        reviewerTokenConfigured: data.github?.reviewerTokenConfigured || false,
      });
      if (data.github?.defaultRepo) setGithubDefaultRepo(data.github.defaultRepo);
      setGitlabStatus({ connected: data.gitlab?.configured || false, lastChecked: new Date().toISOString() });
      setBitbucketStatus({
        connected: data.bitbucket?.configured || false,
        lastChecked: new Date().toISOString(),
        webhookSecretConfigured: data.bitbucket?.webhookSecretConfigured || false,
      });
      if (data.bitbucket?.username) setBitbucketUsername(data.bitbucket.username);
      if (data.bitbucket?.defaultRepo) setBitbucketDefaultRepo(data.bitbucket.defaultRepo);
      setLinearStatus({ connected: data.linear?.configured || false, lastChecked: new Date().toISOString(), webhookSecretConfigured: data.linear?.webhookSecretConfigured || false });
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
        costAlerts: false,
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
    } catch (_err) {
      setMessage({ type: "error", text: "Failed to save your notification preferences" });
    } finally {
      setUserEmailPrefsSaving(false);
    }
  };

  // Update user email preference helper
  const updateUserEmailPref = <K extends keyof EmailPreferences>(key: K, value: EmailPreferences[K]) => {
    setUserEmailPreferences((prev) => ({ ...prev, [key]: value }));
  };

  // Open Stripe billing portal for plan management
  const handleOpenBillingPortal = async () => {
    if (!tokens?.accessToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/billing/portal`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (res.ok) {
        const { url } = await res.json();
        window.location.href = url;
      } else {
        const error = await res.json();
        setMessage({ type: "error", text: error.error || "Failed to open billing portal" });
      }
    } catch (_err) {
      setMessage({ type: "error", text: "Failed to open billing portal" });
    }
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
      const response = await fetch(`${API_BASE}/api/billing/status`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        // Map subscription data to UsageData interface
        setUsageData({
          tasks: {
            used: data.usage?.tasks ?? 0,
            quota: data.usage?.quota ?? 0,
            percent: data.usage?.percent ?? 0,
            isUnlimited: data.usage?.isUnlimited ?? false,
          },
          plan: data.plan?.id ?? data.plan ?? "pro",
          billingPeriod: {
            start: data.billing?.periodStart ?? null,
            daysUntilReset: data.billing?.daysRemaining ?? 0,
          },
        });
      }
    } catch (err) {
      console.error("Failed to fetch usage data:", err);
    } finally {
      setUsageLoading(false);
    }
  }, [tokens?.accessToken]);

  const fetchProviderStatus = useCallback(async () => {
    if (!tokens?.accessToken) return;

    const providers = ["anthropic", "openai", "google", "openrouter", "groq", "deepseek", "mistral", "xai", "azure"] as const;

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
          openrouter: setOpenrouterProvider,
          groq: setGroqProvider,
          deepseek: setDeepseekProvider,
          mistral: setMistralProvider,
          xai: setXaiProvider,
          azure: setAzureProvider,
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
      fetchUserOrganizations();
    }
  }, [tokens?.accessToken, fetchSettings, fetchIntegrations, fetchTeamMembers, fetchPendingInvites, fetchUsageData, fetchProviderStatus, fetchUserEmailPreferences, fetchMcpApiKeys, fetchUserOrganizations]);

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

  // Fetch remote agents when category is active
  useEffect(() => {
    if (activeCategory === "remote-agent" && tokens?.accessToken) {
      setRemoteAgentsLoading(true);
      fetch(`${API_BASE}/api/settings/remote-agents`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
        .then((res) => res.json())
        .then((data) => setRemoteAgents(data.agents || []))
        .catch(() => setRemoteAgents([]))
        .finally(() => setRemoteAgentsLoading(false));
    }
  }, [activeCategory, tokens?.accessToken]);

  // Validation
  const validateSettings = (): boolean => {
    const errors: ValidationErrors = {};
    if (settings.logRetentionDays !== -1 && (settings.logRetentionDays < 1 || settings.logRetentionDays > 365)) {
      errors.logRetentionDays = "Must be between 1 and 365 days";
    }
    if (settings.taskRetentionDays !== -1 && (settings.taskRetentionDays < 1 || settings.taskRetentionDays > 365)) {
      errors.taskRetentionDays = "Must be between 1 and 365 days";
    }
    if (settings.maxConcurrentWorkers < 1 || settings.maxConcurrentWorkers > 14) {
      errors.maxConcurrentWorkers = "Must be between 1 and 14";
    }
    if (settings.maxParallelExperts < 1 || settings.maxParallelExperts > 14) {
      errors.maxParallelExperts = "Must be between 1 and 14";
    }
    if (settings.ralphMaxStories < 1 || settings.ralphMaxStories > 50) {
      errors.ralphMaxStories = "Must be between 1 and 50";
    }
    if (settings.defaultMaxRetries < 0 || settings.defaultMaxRetries > 5) {
      errors.defaultMaxRetries = "Must be between 0 and 5 retries";
    }
    if (settings.taskCooldownSeconds < 0 || settings.taskCooldownSeconds > 86400) {
      errors.taskCooldownSeconds = "Must be between 0 and 86400 seconds";
    }
    if (settings.costAlertThresholdUsd !== null && settings.costAlertThresholdUsd < 0) {
      errors.costAlertThresholdUsd = "Must be a positive value or empty";
    }
    if (settings.dailyBudgetLimitUsd !== null && settings.dailyBudgetLimitUsd < 0) {
      errors.dailyBudgetLimitUsd = "Must be a positive value or empty";
    }
    if (settings.weeklyBudgetLimitUsd !== null && settings.weeklyBudgetLimitUsd < 0) {
      errors.weeklyBudgetLimitUsd = "Must be a positive value or empty";
    }
    if (settings.monthlyBudgetLimitUsd !== null && settings.monthlyBudgetLimitUsd < 0) {
      errors.monthlyBudgetLimitUsd = "Must be a positive value or empty";
    }
    if (settings.perTaskCostCeilingUsd !== null && settings.perTaskCostCeilingUsd < 0) {
      errors.perTaskCostCeilingUsd = "Must be a positive value or empty";
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

  // Reset counters handler
  const handleResetCounters = async () => {
    if (!confirm("Reset all statistics counters? This will start tracking from now. Historical data will not be deleted.")) {
      return;
    }
    setResetCountersLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/control-center/reset-counters`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (response.ok) {
        setResetMessage({ type: "success", text: "All counters have been reset" });
        setTimeout(() => setResetMessage(null), 3000);
      } else {
        const err = await response.json();
        setResetMessage({ type: "error", text: err.error || "Failed to reset counters" });
        setTimeout(() => setResetMessage(null), 5000);
      }
    } catch {
      setResetMessage({ type: "error", text: "Failed to reset counters" });
      setTimeout(() => setResetMessage(null), 5000);
    } finally {
      setResetCountersLoading(false);
    }
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

  const handleTestGitlab = async () => {
    setGitlabTesting(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/gitlab/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "GitLab connection failed");
      if (!data.success) throw new Error(data.error || "GitLab connection failed");
      setGitlabStatus({ connected: true, lastChecked: new Date().toISOString() });
      setMessage({ type: "success", text: `GitLab connection successful${data.user ? ` (${data.user})` : ""}` });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "GitLab connection failed" });
      setGitlabStatus({ connected: false, lastChecked: new Date().toISOString() });
    } finally {
      setGitlabTesting(false);
    }
  };

  const handleTestBitbucket = async () => {
    setBitbucketTesting(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/bitbucket/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "BitBucket connection failed");
      if (!data.success) throw new Error(data.error || "BitBucket connection failed");
      setBitbucketStatus({ connected: true, lastChecked: new Date().toISOString() });
      setMessage({ type: "success", text: `BitBucket connection successful${data.user ? ` (${data.user})` : ""}` });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "BitBucket connection failed" });
      setBitbucketStatus({ connected: false, lastChecked: new Date().toISOString() });
    } finally {
      setBitbucketTesting(false);
    }
  };

  const handleSaveGitlab = async () => {
    setGitlabSaving(true);
    setMessage(null);
    try {
      const payload: { token?: string; webhookSecret?: string } = {};
      if (gitlabToken) payload.token = gitlabToken;
      if (gitlabWebhookSecret) payload.webhookSecret = gitlabWebhookSecret;
      const response = await fetch(`${API_BASE}/api/settings/integrations/gitlab`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save GitLab credentials");
      // Auto-set GitLab as the default SCM provider
      await handleSetDefaultScm("gitlab");
      setMessage({ type: "success", text: "GitLab settings saved successfully" });
      setGitlabToken("");
      setGitlabWebhookSecret("");
      fetchIntegrations();
      setGitlabSlideOpen(false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save GitLab credentials" });
    } finally {
      setGitlabSaving(false);
    }
  };

  const handleSaveBitbucket = async () => {
    setBitbucketSaving(true);
    setMessage(null);
    try {
      const payload: { username?: string; email?: string; appPassword?: string; defaultRepo?: string; webhookSecret?: string } = {};
      if (bitbucketUsername) {
        payload.username = bitbucketUsername;
        payload.email = bitbucketUsername; // Bitbucket REST API auth requires email:token
      }
      if (bitbucketAppPassword) payload.appPassword = bitbucketAppPassword;
      if (bitbucketDefaultRepo) payload.defaultRepo = bitbucketDefaultRepo;
      if (bitbucketWebhookSecret) payload.webhookSecret = bitbucketWebhookSecret;
      const response = await fetch(`${API_BASE}/api/settings/integrations/bitbucket`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save BitBucket credentials");
      // Auto-set Bitbucket as the default SCM provider
      await handleSetDefaultScm("bitbucket");
      setMessage({ type: "success", text: "BitBucket settings saved successfully" });
      setBitbucketUsername("");
      setBitbucketAppPassword("");
      setBitbucketDefaultRepo("");
      setBitbucketWebhookSecret("");
      fetchIntegrations();
      setBitbucketSlideOpen(false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save BitBucket credentials" });
    } finally {
      setBitbucketSaving(false);
    }
  };

  const handleSaveGithub = async () => {
    setGithubSaving(true);
    setMessage(null);
    try {
      const payload: { token?: string; reviewerToken?: string; defaultRepo?: string; webhookSecret?: string } = {};
      if (githubToken) payload.token = githubToken;
      if (githubReviewerToken) payload.reviewerToken = githubReviewerToken;
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
      // Auto-set GitHub as the default SCM provider
      await handleSetDefaultScm("github");
      setMessage({ type: "success", text: "GitHub settings saved successfully" });
      setGithubToken("");
      setGithubReviewerToken("");
      setGithubWebhookSecret("");
      fetchIntegrations();
      setGithubSlideOpen(false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save GitHub credentials" });
    } finally {
      setGithubSaving(false);
    }
  };

  // Set default SCM provider
  const handleSetDefaultScm = async (provider: "github" | "gitlab" | "bitbucket") => {
    setSettingsSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scmProvider: provider }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to set default SCM provider");
      }
      const data = await response.json();
      const savedSettings = data.settings || data;
      setOriginalSettings(savedSettings);
      setSettings(savedSettings);
      setMessage({ type: "success", text: `${provider.charAt(0).toUpperCase() + provider.slice(1)} set as default SCM provider` });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to set default SCM provider" });
    } finally {
      setSettingsSaving(false);
    }
  };

  // Set default Issue Tracker provider
  const handleSetDefaultIssueTracker = async (provider: "jira" | "linear" | "github-issues" | "internal") => {
    setSettingsSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ issueTrackerProvider: provider }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to set default issue tracker");
      }
      const data = await response.json();
      const savedSettings = data.settings || data;
      setOriginalSettings(savedSettings);
      setSettings(savedSettings);
      const displayName = provider === "github-issues" ? "GitHub Issues" : provider === "internal" ? "Internal (Boards)" : provider.charAt(0).toUpperCase() + provider.slice(1);
      setMessage({ type: "success", text: `${displayName} set as default issue tracker` });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to set default issue tracker" });
    } finally {
      setSettingsSaving(false);
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
        if (data.trustPolicyExample?.Statement?.[0]?.Principal?.AWS) {
          setWorkerTaskRoleArn(data.trustPolicyExample.Statement[0].Principal.AWS);
        }
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
  const handleTestProvider = async (providerId: "anthropic" | "openai" | "google" | "openrouter" | "groq" | "deepseek" | "mistral" | "xai" | "azure") => {
    const setProvider = {
      anthropic: setAnthropicProvider,
      openai: setOpenaiProvider,
      google: setGoogleProvider,
      openrouter: setOpenrouterProvider,
      groq: setGroqProvider,
      deepseek: setDeepseekProvider,
      mistral: setMistralProvider,
      xai: setXaiProvider,
      azure: setAzureProvider,
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

  const handleSaveProvider = async (providerId: "anthropic" | "openai" | "google" | "openrouter" | "groq" | "deepseek" | "mistral" | "xai" | "azure") => {
    const providers = {
      anthropic: { state: anthropicProvider, setter: setAnthropicProvider, setSlide: setAnthropicSlideOpen },
      openai: { state: openaiProvider, setter: setOpenaiProvider, setSlide: setOpenaiSlideOpen },
      google: { state: googleProvider, setter: setGoogleProvider, setSlide: setGoogleSlideOpen },
      openrouter: { state: openrouterProvider, setter: setOpenrouterProvider, setSlide: setOpenrouterSlideOpen },
      groq: { state: groqProvider, setter: setGroqProvider, setSlide: setGroqSlideOpen },
      deepseek: { state: deepseekProvider, setter: setDeepseekProvider, setSlide: setDeepseekSlideOpen },
      mistral: { state: mistralProvider, setter: setMistralProvider, setSlide: setMistralSlideOpen },
      xai: { state: xaiProvider, setter: setXaiProvider, setSlide: setXaiSlideOpen },
      azure: { state: azureProvider, setter: setAzureProvider, setSlide: setAzureOpenaiSlideOpen },
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

  const handleResendInvite = async (inviteId: string) => {
    setResendingInviteId(inviteId);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/organizations/current/invites/${inviteId}/resend`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to resend invite");
      }
      setMessage({ type: "success", text: "Invite email sent successfully" });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to resend invite" });
    } finally {
      setResendingInviteId(null);
    }
  };

  // Update member role
  const handleUpdateMemberRole = async (memberId: string, newRole: "admin" | "member" | "viewer") => {
    setUpdatingMemberRole(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/organizations/current/members/${memberId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update member role");
      }
      setMessage({ type: "success", text: `Role updated to ${newRole}` });
      setEditingMemberId(null);
      fetchTeamMembers();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to update member role" });
    } finally {
      setUpdatingMemberRole(false);
    }
  };

  // Remove member from organization
  const handleRemoveMember = async () => {
    if (!memberToRemove) return;

    setRemovingMemberId(memberToRemove.id);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/organizations/current/members/${memberToRemove.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokens?.accessToken}` },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to remove member");
      }
      setMessage({ type: "success", text: "Member removed from organization" });
      setShowRemoveConfirmModal(false);
      setMemberToRemove(null);
      fetchTeamMembers();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to remove member" });
    } finally {
      setRemovingMemberId(null);
    }
  };

  // Open remove confirmation modal
  const confirmRemoveMember = (member: TeamMember) => {
    setMemberToRemove(member);
    setShowRemoveConfirmModal(true);
  };

  // Check if current user is admin or owner (both can manage members)
  const isCurrentUserAdmin = currentUser?.role === "admin" || currentUser?.role === "owner";

  // Helpers
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
    const model = currentModels.find((m) => m.value === settings.defaultWorkerModel)?.label || "Sonnet 4.6";
    return `${provider} ${model}`;
  };

  const getExecutionSummary = () => {
    return `${settings.maxConcurrentWorkers} container${settings.maxConcurrentWorkers !== 1 ? "s" : ""}, ${settings.maxParallelExperts} experts`;
  };

  const getManagerSummary = () => {
    const provider = PROVIDER_OPTIONS.find((p) => p.value === settings.managerProvider)?.label.split(" ")[0] || "Anthropic";
    const models = MODEL_OPTIONS[settings.managerProvider] || MODEL_OPTIONS.anthropic;
    const model = models.find((m) => m.value === settings.managerModelId)?.label || "Opus 4.6";
    return `${provider} ${model}`;
  };

  const getRoutingSummary = () => {
    const routeCount = Object.keys(settings.providerRouting).filter(
      (k) => settings.providerRouting[k]?.provider
    ).length;
    if (routeCount === 0) return "No custom routes";
    return `${routeCount} custom route${routeCount > 1 ? "s" : ""} configured`;
  };

  // Render category content
  // Render category content
  const renderCategoryContent = () => {
    switch (activeCategory) {
      case "general":
        return (
          <GeneralSection
            settings={settings}
            updateSetting={updateSetting}
            orgName={orgName || ""}
            orgSlug={orgSlug || ""}
            organization={organization}
            userOrganizations={userOrganizations}
            orgsLoading={orgsLoading}
            usageLoading={usageLoading}
            usageData={usageData}
          />
        );
      case "team":
        return (
          <TeamSection
            teamMembers={teamMembers}
            teamMembersLoading={teamMembersLoading}
            currentUser={currentUser}
            isCurrentUserAdmin={isCurrentUserAdmin}
            orgPlan={organization?.plan}
            editingMemberId={editingMemberId}
            setEditingMemberId={setEditingMemberId}
            handleUpdateMemberRole={handleUpdateMemberRole}
            updatingMemberRole={updatingMemberRole}
            getRoleBadgeColor={getRoleBadgeColor}
            confirmRemoveMember={confirmRemoveMember}
            removingMemberId={removingMemberId}
            pendingInvites={pendingInvites}
            invitesLoading={invitesLoading}
            formatDate={formatDate}
            handleResendInvite={handleResendInvite}
            resendingInviteId={resendingInviteId}
            handleRevokeInvite={handleRevokeInvite}
            revokingInviteId={revokingInviteId}
            setShowInviteModal={setShowInviteModal}
          />
        );
      case "ai-workers":
        return (
          <AIWorkersSection
            settings={settings}
            updateSetting={updateSetting}
            settingsLoading={settingsLoading}
            validationErrors={validationErrors}
            currentModels={currentModels}
            getWorkersSummary={getWorkersSummary}
            getManagerSummary={getManagerSummary}
            getExecutionSummary={getExecutionSummary}
            getRoutingSummary={getRoutingSummary}
            orgPlan={organization?.plan}
          />
        );
      case "quality":
        return (
          <QualitySection
            settings={settings}
            updateSetting={updateSetting}
            validationErrors={validationErrors}
            orgPlan={organization?.plan}
          />
        );
      case "integrations":
        return (
          <IntegrationsSection
            settings={settings}
            settingsSaving={settingsSaving}
            orgPlan={organization?.plan}
            handleSetDefaultIssueTracker={handleSetDefaultIssueTracker}
            jiraStatus={jiraStatus}
            githubStatus={githubStatus}
            gitlabStatus={gitlabStatus}
            bitbucketStatus={bitbucketStatus}
            slackStatus={slackStatus}
            linearStatus={linearStatus}
            teamsStatus={teamsStatus}
            awsStatus={awsStatus}
            gcpStatus={gcpStatus}
            azureStatus={azureStatus}
            anthropicProvider={anthropicProvider}
            openaiProvider={openaiProvider}
            googleProvider={googleProvider}
            openrouterProvider={openrouterProvider}
            groqProvider={groqProvider}
            deepseekProvider={deepseekProvider}
            mistralProvider={mistralProvider}
            xaiProvider={xaiProvider}
            azureProvider={azureProvider}
            mcpApiKeys={mcpApiKeys}
            setJiraSlideOpen={setJiraSlideOpen}
            setGithubSlideOpen={setGithubSlideOpen}
            setGitlabSlideOpen={setGitlabSlideOpen}
            setBitbucketSlideOpen={setBitbucketSlideOpen}
            setSlackSlideOpen={setSlackSlideOpen}
            setLinearSlideOpen={setLinearSlideOpen}
            setTeamsSlideOpen={setTeamsSlideOpen}
            setAwsSlideOpen={setAwsSlideOpen}
            handleAwsSlideOpen={handleAwsSlideOpen}
            setGcpSlideOpen={setGcpSlideOpen}
            setAzureSlideOpen={setAzureSlideOpen}
            setAnthropicSlideOpen={setAnthropicSlideOpen}
            setOpenaiSlideOpen={setOpenaiSlideOpen}
            setGoogleSlideOpen={setGoogleSlideOpen}
            setOpenrouterSlideOpen={setOpenrouterSlideOpen}
            setGroqSlideOpen={setGroqSlideOpen}
            setDeepseekSlideOpen={setDeepseekSlideOpen}
            setMistralSlideOpen={setMistralSlideOpen}
            setXaiSlideOpen={setXaiSlideOpen}
            setAzureOpenaiSlideOpen={setAzureOpenaiSlideOpen}
            setOllamaSlideOpen={setOllamaSlideOpen}
            setWorkermillSlideOpen={setWorkermillSlideOpen}
            fetchMcpApiKeys={fetchMcpApiKeys}
          />
        );
      case "remote-agent":
        return (
          <RemoteAgentSection
            remoteAgents={remoteAgents}
            remoteAgentsLoading={remoteAgentsLoading}
            orgPlan={organization?.plan}
            apiKeyPrefix={settings?.apiKeyPrefix}
          />
        );
      case "billing":
        return (
          <BillingSection
            settings={settings}
            updateSetting={updateSetting}
            settingsLoading={settingsLoading}
            settingsSaving={settingsSaving}
            validationErrors={validationErrors}
            hasUnsavedChanges={hasUnsavedChanges}
            handleSaveSettings={handleSaveSettings}
            organization={organization}
            handleOpenBillingPortal={handleOpenBillingPortal}
            handleResetCounters={handleResetCounters}
            resetCountersLoading={resetCountersLoading}
            resetMessage={resetMessage}
          />
        );
      case "notifications":
        return (
          <NotificationsSection
            settings={settings}
            updateSetting={updateSetting}
            settingsLoading={settingsLoading}
            settingsSaving={settingsSaving}
            validationErrors={validationErrors}
            hasUnsavedChanges={hasUnsavedChanges}
            handleSaveSettings={handleSaveSettings}
            userEmailPreferences={userEmailPreferences}
            userEmailPrefsLoading={userEmailPrefsLoading}
            userEmailPrefsSaving={userEmailPrefsSaving}
            hasUnsavedUserEmailPrefs={hasUnsavedUserEmailPrefs}
            updateUserEmailPref={updateUserEmailPref}
            saveUserEmailPreferences={saveUserEmailPreferences}
            testEmailLoading={testEmailLoading}
            setTestEmailLoading={setTestEmailLoading}
            testEmailMessage={testEmailMessage}
            setTestEmailMessage={setTestEmailMessage}
            slackStatus={slackStatus}
            teamsStatus={teamsStatus}
            setSlackSlideOpen={setSlackSlideOpen}
            setTeamsSlideOpen={setTeamsSlideOpen}
          />
        );
      case "data":
        return (
          <DataSection
            settings={settings}
            updateSetting={updateSetting}
            settingsLoading={settingsLoading}
            validationErrors={validationErrors}
            orgPlan={organization?.plan}
          />
        );
      default:
        return null;
    }
  };


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
            <nav className="p-4 space-y-1" data-testid="settings-nav">
              {NAV_ITEMS.map((item) =>
                item.href ? (
                  <Link
                    key={item.id}
                    to={item.href}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    data-testid={`settings-nav-${item.id}`}
                  >
                    {item.icon}
                    <span className="text-sm font-medium">{item.label}</span>
                    <ChevronRight className="w-4 h-4 ml-auto" />
                  </Link>
                ) : (
                  <button
                    key={item.id}
                    onClick={() => setActiveCategory(item.id)}
                    data-testid={`settings-nav-${item.id}`}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                      activeCategory === item.id
                        ? "bg-primary/10 text-primary border-l-4 border-primary -ml-[2px] pl-[14px]"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    }`}
                  >
                    {item.icon}
                    <span className="text-sm font-medium">{item.label}</span>
                  </button>
                )
              )}

              {/* External Links */}
              {externalLinks.length > 0 && (
                <div className="mt-6 pt-4 border-t border-border/30">
                  <p className="px-3 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Enterprise</p>
                  {externalLinks.map((link) => (
                    <Link
                      key={link.label}
                      to={link.href}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    >
                      {link.icon}
                      <span className="text-sm font-medium">{link.label}</span>
                      <ChevronRight className="w-4 h-4 ml-auto" />
                    </Link>
                  ))}
                </div>
              )}
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
                  data-testid="settings-save"
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

        {/* Remove Member Confirmation Modal */}
        {showRemoveConfirmModal && memberToRemove && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-border rounded-xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  Remove Team Member
                </h3>
                <button
                  onClick={() => { setShowRemoveConfirmModal(false); setMemberToRemove(null); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Are you sure you want to remove <span className="font-semibold text-foreground">{memberToRemove.fullName || memberToRemove.email}</span> from the organization?
                </p>
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-xs text-red-400">
                    This will revoke their access to all organization resources. They can be re-invited later if needed.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => { setShowRemoveConfirmModal(false); setMemberToRemove(null); }}
                  className="flex-1 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRemoveMember}
                  disabled={removingMemberId === memberToRemove.id}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 transition-all disabled:opacity-50"
                >
                  {removingMemberId === memberToRemove.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Remove Member
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
                .
              </p>
              {getWebhookUrl("jira") && (
                <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Your Webhook URL</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-background px-2 py-1.5 rounded border border-border overflow-x-auto">
                      {getWebhookUrl("jira")}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(getWebhookUrl("jira") || "");
                        setMessage({ type: "success", text: "Webhook URL copied!" });
                      }}
                      className="p-1.5 hover:bg-muted rounded transition-colors"
                      title="Copy to clipboard"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
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

            {/* Set as Default Issue Tracker */}
            <div className="border-t border-border pt-4">
              {settings?.issueTrackerProvider === "jira" ? (
                <div className="flex items-center gap-2 text-sm text-green-500">
                  <CheckCircle className="w-4 h-4" />
                  <span>Jira is the default issue tracker</span>
                </div>
              ) : (
                <button
                  onClick={() => handleSetDefaultIssueTracker("jira")}
                  disabled={settingsSaving || !jiraStatus.connected}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-primary text-primary rounded-lg hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Set as Default Issue Tracker
                </button>
              )}
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
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Worker Token
                {githubStatus.connected && (
                  <span className="ml-2 text-xs text-green-500">(configured)</span>
                )}
              </label>
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
              <p className="text-xs text-muted-foreground mt-1">
                Used by AI workers to create branches and pull requests.
              </p>
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
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Reviewer Token
                {githubStatus.reviewerTokenConfigured && (
                  <span className="ml-2 text-xs text-green-500">(configured)</span>
                )}
              </label>
              <div className="relative">
                <input
                  type={githubReviewerVisible ? "text" : "password"}
                  value={githubReviewerToken}
                  onChange={(e) => setGithubReviewerToken(e.target.value)}
                  placeholder={githubStatus.reviewerTokenConfigured ? "••••••••••••" : "ghp_xxxxxxxxxxxx"}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setGithubReviewerVisible(!githubReviewerVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {githubReviewerVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Required for PR approvals. Must be from a different GitHub account than the worker token to avoid GitHub&apos;s self-approval restriction.
              </p>
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
              {getWebhookUrl("github") && (
                <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Your Webhook URL</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-background px-2 py-1.5 rounded border border-border overflow-x-auto">
                      {getWebhookUrl("github")}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(getWebhookUrl("github") || "");
                        setMessage({ type: "success", text: "Webhook URL copied!" });
                      }}
                      className="p-1.5 hover:bg-muted rounded transition-colors"
                      title="Copy to clipboard"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
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
                disabled={githubSaving || (!githubToken && !githubReviewerToken && !githubDefaultRepo && !githubWebhookSecret)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50"
              >
                {githubSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>

            {/* Set as Default */}
            <div className="border-t border-border pt-4 mt-4">
              {settings.scmProvider === "github" ? (
                <div className="flex items-center gap-2 text-sm text-primary">
                  <CheckCircle className="w-4 h-4" />
                  GitHub is your default SCM provider
                </div>
              ) : (
                <button
                  onClick={() => handleSetDefaultScm("github")}
                  disabled={settingsSaving || !githubStatus.connected}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-primary text-primary rounded-lg hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Set as Default SCM Provider
                </button>
              )}
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
              {getWebhookUrl("gitlab") && (
                <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Your Webhook URL</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-background px-2 py-1.5 rounded border border-border overflow-x-auto">
                      {getWebhookUrl("gitlab")}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(getWebhookUrl("gitlab") || "");
                        setMessage({ type: "success", text: "Webhook URL copied!" });
                      }}
                      className="p-1.5 hover:bg-muted rounded transition-colors"
                      title="Copy to clipboard"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={handleTestGitlab}
                disabled={gitlabTesting || !gitlabStatus.connected}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {gitlabTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={handleSaveGitlab}
                disabled={gitlabSaving || (!gitlabToken && !gitlabWebhookSecret)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-500 transition-colors disabled:opacity-50"
              >
                {gitlabSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>

            {/* Set as Default */}
            <div className="border-t border-border pt-4 mt-4">
              {settings.scmProvider === "gitlab" ? (
                <div className="flex items-center gap-2 text-sm text-primary">
                  <CheckCircle className="w-4 h-4" />
                  GitLab is your default SCM provider
                </div>
              ) : (
                <button
                  onClick={() => handleSetDefaultScm("gitlab")}
                  disabled={settingsSaving || !gitlabStatus.connected}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-primary text-primary rounded-lg hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Set as Default SCM Provider
                </button>
              )}
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
              <label className="block text-sm font-medium text-muted-foreground mb-2">Email Address</label>
              <input
                type="email"
                value={bitbucketUsername}
                onChange={(e) => setBitbucketUsername(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
              />
              <p className="mt-1 text-xs text-muted-foreground">BitBucket Cloud requires your email address for API authentication</p>
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
              {getWebhookUrl("bitbucket") && (
                <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Your Webhook URL</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-background px-2 py-1.5 rounded border border-border overflow-x-auto">
                      {getWebhookUrl("bitbucket")}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(getWebhookUrl("bitbucket") || "");
                        setMessage({ type: "success", text: "Webhook URL copied!" });
                      }}
                      className="p-1.5 hover:bg-muted rounded transition-colors"
                      title="Copy to clipboard"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={handleTestBitbucket}
                disabled={bitbucketTesting || !bitbucketStatus.connected}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {bitbucketTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={handleSaveBitbucket}
                disabled={bitbucketSaving || (!bitbucketUsername && !bitbucketAppPassword && !bitbucketDefaultRepo && !bitbucketWebhookSecret)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50"
              >
                {bitbucketSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>

            {/* Set as Default */}
            <div className="border-t border-border pt-4 mt-4">
              {settings.scmProvider === "bitbucket" ? (
                <div className="flex items-center gap-2 text-sm text-primary">
                  <CheckCircle className="w-4 h-4" />
                  BitBucket is your default SCM provider
                </div>
              ) : (
                <button
                  onClick={() => handleSetDefaultScm("bitbucket")}
                  disabled={settingsSaving || !bitbucketStatus.connected}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-primary text-primary rounded-lg hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Set as Default SCM Provider
                </button>
              )}
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

        {/* OpenRouter SlideOver */}
        <SlideOver
          isOpen={openrouterSlideOpen}
          onClose={() => setOpenrouterSlideOpen(false)}
          title="Configure OpenRouter"
          icon={<span className="text-2xl">🔀</span>}
          iconBgColor="bg-cyan-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-cyan-500/5 border border-cyan-500/20">
              <p className="text-sm text-muted-foreground">
                OpenRouter provides access to 300+ AI models through a single API. Use models from Anthropic, OpenAI, Google, Meta, Mistral, and more.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">API Key</label>
              <div className="relative">
                <input
                  type={openrouterProvider.visible ? "text" : "password"}
                  value={openrouterProvider.apiKey}
                  onChange={(e) => setOpenrouterProvider((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={openrouterProvider.status.configured ? "••••••••••••" : "sk-or-..."}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setOpenrouterProvider((prev) => ({ ...prev, visible: !prev.visible }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {openrouterProvider.visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Get an API key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => handleTestProvider("openrouter")}
                disabled={openrouterProvider.testing || !openrouterProvider.status.configured}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {openrouterProvider.testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={() => handleSaveProvider("openrouter")}
                disabled={openrouterProvider.saving || !openrouterProvider.apiKey}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors disabled:opacity-50"
              >
                {openrouterProvider.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* Groq SlideOver */}
        <SlideOver
          isOpen={groqSlideOpen}
          onClose={() => setGroqSlideOpen(false)}
          title="Configure Groq"
          icon={<span className="text-2xl">⚡</span>}
          iconBgColor="bg-yellow-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
              <p className="text-sm text-muted-foreground">
                Groq provides ultra-fast inference using custom LPU hardware. Get responses up to 10x faster than traditional GPU inference.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">API Key</label>
              <div className="relative">
                <input
                  type={groqProvider.visible ? "text" : "password"}
                  value={groqProvider.apiKey}
                  onChange={(e) => setGroqProvider((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={groqProvider.status.configured ? "••••••••••••" : "gsk_..."}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setGroqProvider((prev) => ({ ...prev, visible: !prev.visible }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {groqProvider.visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Get an API key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => handleTestProvider("groq")}
                disabled={groqProvider.testing || !groqProvider.status.configured}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {groqProvider.testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={() => handleSaveProvider("groq")}
                disabled={groqProvider.saving || !groqProvider.apiKey}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors disabled:opacity-50"
              >
                {groqProvider.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* DeepSeek SlideOver */}
        <SlideOver
          isOpen={deepseekSlideOpen}
          onClose={() => setDeepseekSlideOpen(false)}
          title="Configure DeepSeek"
          icon={<span className="text-2xl">🔍</span>}
          iconBgColor="bg-teal-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-teal-500/5 border border-teal-500/20">
              <p className="text-sm text-muted-foreground">
                DeepSeek offers powerful reasoning models at very competitive prices. Great for complex tasks requiring step-by-step thinking.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">API Key</label>
              <div className="relative">
                <input
                  type={deepseekProvider.visible ? "text" : "password"}
                  value={deepseekProvider.apiKey}
                  onChange={(e) => setDeepseekProvider((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={deepseekProvider.status.configured ? "••••••••••••" : "sk-..."}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setDeepseekProvider((prev) => ({ ...prev, visible: !prev.visible }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {deepseekProvider.visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <a
                href="https://platform.deepseek.com/api_keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Get an API key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => handleTestProvider("deepseek")}
                disabled={deepseekProvider.testing || !deepseekProvider.status.configured}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {deepseekProvider.testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={() => handleSaveProvider("deepseek")}
                disabled={deepseekProvider.saving || !deepseekProvider.apiKey}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors disabled:opacity-50"
              >
                {deepseekProvider.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* Mistral SlideOver */}
        <SlideOver
          isOpen={mistralSlideOpen}
          onClose={() => setMistralSlideOpen(false)}
          title="Configure Mistral AI"
          icon={<span className="text-2xl">🌀</span>}
          iconBgColor="bg-indigo-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-indigo-500/5 border border-indigo-500/20">
              <p className="text-sm text-muted-foreground">
                Mistral AI is Europe's leading AI company. Their models excel at code generation with Codestral and offer excellent multilingual support.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">API Key</label>
              <div className="relative">
                <input
                  type={mistralProvider.visible ? "text" : "password"}
                  value={mistralProvider.apiKey}
                  onChange={(e) => setMistralProvider((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={mistralProvider.status.configured ? "••••••••••••" : "..."}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setMistralProvider((prev) => ({ ...prev, visible: !prev.visible }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {mistralProvider.visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <a
                href="https://console.mistral.ai/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Get an API key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => handleTestProvider("mistral")}
                disabled={mistralProvider.testing || !mistralProvider.status.configured}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {mistralProvider.testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={() => handleSaveProvider("mistral")}
                disabled={mistralProvider.saving || !mistralProvider.apiKey}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50"
              >
                {mistralProvider.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* xAI SlideOver */}
        <SlideOver
          isOpen={xaiSlideOpen}
          onClose={() => setXaiSlideOpen(false)}
          title="Configure xAI"
          icon={<span className="text-2xl font-bold">𝕏</span>}
          iconBgColor="bg-gray-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-gray-500/5 border border-gray-500/20">
              <p className="text-sm text-muted-foreground">
                xAI's Grok models offer strong reasoning capabilities with real-time knowledge and unique personality.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">API Key</label>
              <div className="relative">
                <input
                  type={xaiProvider.visible ? "text" : "password"}
                  value={xaiProvider.apiKey}
                  onChange={(e) => setXaiProvider((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={xaiProvider.status.configured ? "••••••••••••" : "xai-..."}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setXaiProvider((prev) => ({ ...prev, visible: !prev.visible }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {xaiProvider.visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <a
                href="https://console.x.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Get an API key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => handleTestProvider("xai")}
                disabled={xaiProvider.testing || !xaiProvider.status.configured}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {xaiProvider.testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={() => handleSaveProvider("xai")}
                disabled={xaiProvider.saving || !xaiProvider.apiKey}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {xaiProvider.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* Azure AI Foundry SlideOver */}
        <SlideOver
          isOpen={azureOpenaiSlideOpen}
          onClose={() => setAzureOpenaiSlideOpen(false)}
          title="Configure Azure AI Foundry"
          icon={<span className="text-2xl">🔶</span>}
          iconBgColor="bg-sky-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-sky-500/5 border border-sky-500/20">
              <p className="text-sm text-muted-foreground">
                Azure AI Foundry provides access to GPT-4o, o1, and other models through your Azure subscription with enterprise compliance, multi-model support, and agent orchestration.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">API Key</label>
              <div className="relative">
                <input
                  type={azureProvider.visible ? "text" : "password"}
                  value={azureProvider.apiKey}
                  onChange={(e) => setAzureProvider((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={azureProvider.status.configured ? "••••••••••••" : "..."}
                  className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setAzureProvider((prev) => ({ ...prev, visible: !prev.visible }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {azureProvider.visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Use format: ENDPOINT:API_KEY (e.g., https://myresource.openai.azure.com:your-key)
              </p>
              <a
                href="https://ai.azure.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
              >
                Open Azure AI Foundry <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => handleTestProvider("azure")}
                disabled={azureProvider.testing || !azureProvider.status.configured}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {azureProvider.testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Test
              </button>
              <button
                onClick={() => handleSaveProvider("azure")}
                disabled={azureProvider.saving || !azureProvider.apiKey}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600 transition-colors disabled:opacity-50"
              >
                {azureProvider.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>

        {/* Ollama SlideOver */}
        <SlideOver
          isOpen={ollamaSlideOpen}
          onClose={() => setOllamaSlideOpen(false)}
          title="Configure Ollama"
          icon={<span className="text-2xl">🏠</span>}
          iconBgColor="bg-purple-500/20"
        >
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
              <p className="text-sm text-muted-foreground">
                Ollama allows you to run local AI models. Connect your self-hosted Ollama instance to use local models for AI workers.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                <Server className="w-4 h-4" />
                Server URL
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

            <div className="pt-4">
              <a
                href="https://ollama.ai/download"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Download Ollama <ExternalLink className="w-3 h-3" />
              </a>
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
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Webhook Secret (Optional)
                {linearStatus.webhookSecretConfigured && (
                  <span className="ml-2 text-xs text-green-500">(configured)</span>
                )}
              </label>
              <div className="relative">
                <input
                  type={linearWebhookVisible ? "text" : "password"}
                  value={linearWebhookSecret}
                  onChange={(e) => setLinearWebhookSecret(e.target.value)}
                  placeholder={linearStatus.webhookSecretConfigured ? "••••••••••••" : "Used to verify webhook signatures"}
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
                .
              </p>
              {getWebhookUrl("linear") && (
                <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Your Webhook URL</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-background px-2 py-1.5 rounded border border-border overflow-x-auto">
                      {getWebhookUrl("linear")}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(getWebhookUrl("linear") || "");
                        setMessage({ type: "success", text: "Webhook URL copied!" });
                      }}
                      className="p-1.5 hover:bg-muted rounded transition-colors"
                      title="Copy to clipboard"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
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

            {/* Set as Default Issue Tracker */}
            <div className="border-t border-border pt-4">
              {settings?.issueTrackerProvider === "linear" ? (
                <div className="flex items-center gap-2 text-sm text-green-500">
                  <CheckCircle className="w-4 h-4" />
                  <span>Linear is the default issue tracker</span>
                </div>
              ) : (
                <button
                  onClick={() => handleSetDefaultIssueTracker("linear")}
                  disabled={settingsSaving || !linearStatus.connected}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-primary text-primary rounded-lg hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Set as Default Issue Tracker
                </button>
              )}
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
      "AWS": "${workerTaskRoleArn || "<WORKERMILL_WORKER_ROLE_ARN>"}"
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


      </ErrorBoundaryWithRetry>
    </div>
  );
}
