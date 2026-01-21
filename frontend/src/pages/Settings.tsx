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
  Bell,
  Send,
  X,
  BarChart3,
  Router,
  Server,
  Plus,
  Settings as SettingsIcon,
  Link as LinkIcon,
  RotateCcw,
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
}

interface ProviderRoutingConfig {
  provider: string;
  model?: string;
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
  costAlertThresholdUsd: number | null;
  completedTaskDisplayMinutes: number;
  intermediateTaskDisplayMinutes: number;
  dryRunVisibilityMinutes: number;
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

type SettingsCategory = "general" | "team" | "ai-workers" | "integrations" | "data";

// Navigation items
const NAV_ITEMS: { id: SettingsCategory; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <Building className="w-5 h-5" /> },
  { id: "team", label: "Team", icon: <Users className="w-5 h-5" /> },
  { id: "ai-workers", label: "AI Workers", icon: <Cpu className="w-5 h-5" /> },
  { id: "integrations", label: "Integrations", icon: <LinkIcon className="w-5 h-5" /> },
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
    costAlertThresholdUsd: null,
    completedTaskDisplayMinutes: 10,
    intermediateTaskDisplayMinutes: 60,
    dryRunVisibilityMinutes: 1,
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
  const [jiraStatus, setJiraStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [jiraVisible, setJiraVisible] = useState(false);
  const [jiraTesting, setJiraTesting] = useState(false);
  const [jiraSaving, setJiraSaving] = useState(false);
  const [_integrationsLoading, setIntegrationsLoading] = useState(true);

  const [githubToken, setGithubToken] = useState("");
  const [githubDefaultRepo, setGithubDefaultRepo] = useState("");
  const [githubStatus, setGithubStatus] = useState<IntegrationStatus>({ connected: false, lastChecked: null });
  const [githubVisible, setGithubVisible] = useState(false);
  const [githubTesting, setGithubTesting] = useState(false);
  const [githubSaving, setGithubSaving] = useState(false);

  // Slide-over states for integrations
  const [jiraSlideOpen, setJiraSlideOpen] = useState(false);
  const [githubSlideOpen, setGithubSlideOpen] = useState(false);

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

  // Slack webhook test state
  const [slackWebhookTesting, setSlackWebhookTesting] = useState(false);

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
      { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", tier: "Balanced" },
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro", tier: "Powerful" },
      { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash", tier: "Fast" },
    ],
    ollama: [
      { value: "qwen3-coder:30b", label: "Qwen 3 Coder 30B", tier: "Recommended" },
      { value: "qwen2.5-coder:14b", label: "Qwen 2.5 Coder 14B", tier: "Recommended" },
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
    { value: "devops_engineer", label: "DevOps Engineer" },
    { value: "security_engineer", label: "Security Engineer" },
    { value: "qa_engineer", label: "QA Engineer" },
    { value: "tech_writer", label: "Technical Writer" },
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
        costAlertThresholdUsd: data.costAlertThresholdUsd ?? null,
        completedTaskDisplayMinutes: data.completedTaskDisplayMinutes ?? 10,
        intermediateTaskDisplayMinutes: data.intermediateTaskDisplayMinutes ?? 60,
        dryRunVisibilityMinutes: data.dryRunVisibilityMinutes ?? 1,
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
      setJiraStatus({ connected: data.jira?.configured || false, lastChecked: new Date().toISOString() });
      if (data.jira?.baseUrl) setJiraBaseUrl(data.jira.baseUrl);
      setGithubStatus({ connected: data.github?.configured || false, lastChecked: new Date().toISOString() });
      if (data.github?.defaultRepo) setGithubDefaultRepo(data.github.defaultRepo);
    } catch (err) {
      console.error("Failed to fetch integration status:", err);
    } finally {
      setIntegrationsLoading(false);
    }
  }, [tokens?.accessToken]);

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

  useEffect(() => {
    if (tokens?.accessToken) {
      fetchSettings();
      fetchIntegrations();
      fetchTeamMembers();
      fetchPendingInvites();
      fetchUsageData();
    }
  }, [tokens?.accessToken, fetchSettings, fetchIntegrations, fetchTeamMembers, fetchPendingInvites, fetchUsageData]);

  useEffect(() => {
    if (originalSettings) {
      setHasUnsavedChanges(JSON.stringify(settings) !== JSON.stringify(originalSettings));
    }
  }, [settings, originalSettings]);

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
    setJiraSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/jira`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ baseUrl: jiraBaseUrl, email: jiraEmail, apiToken: jiraApiKey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save Jira credentials");
      setMessage({ type: "success", text: "Jira settings saved successfully" });
      setJiraApiKey("");
      fetchIntegrations();
      setJiraSlideOpen(false);
    } catch (err) {
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
      const payload: { token?: string; defaultRepo: string } = { defaultRepo: githubDefaultRepo };
      if (githubToken) payload.token = githubToken;
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
      fetchIntegrations();
      setGithubSlideOpen(false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save GitHub credentials" });
    } finally {
      setGithubSaving(false);
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
      setMessage({ type: "success", text: "Slack webhook test successful! Check your Slack channel." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Slack webhook test failed" });
    } finally {
      setSlackWebhookTesting(false);
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
              <a href="#" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
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
                <h4 className="text-sm font-medium text-indigo-400 mb-2">Virtual Manager Role</h4>
                <p className="text-xs text-muted-foreground">
                  The Virtual Manager reviews all PRs created by AI workers before they are merged.
                  Use the <strong>review</strong> label on Jira tickets to require manager review.
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

        {/* Slack Card */}
        <div className="border border-border/50 rounded-xl p-6 bg-card hover:border-purple-500/50 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Bell className="w-7 h-7 text-purple-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">Slack</h3>
              <p className="text-xs text-muted-foreground">Notifications</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleTestSlackWebhook}
              disabled={slackWebhookTesting}
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-500 text-white text-sm rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50"
            >
              {slackWebhookTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Test Webhook
            </button>
          </div>
        </div>
      </div>
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
                disabled={jiraSaving || !jiraApiKey || !jiraBaseUrl || !jiraEmail}
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
                disabled={githubSaving || (!githubToken && !githubDefaultRepo)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50"
              >
                {githubSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </SlideOver>
      </ErrorBoundaryWithRetry>
    </div>
  );
}
