import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Key,
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
  Sparkles,
  FileText,
  UserPlus,
  Mail,
  Trash2,
  Bell,
  Send,
  X,
  BarChart3,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface IntegrationStatus {
  connected: boolean;
  lastChecked: string | null;
}

interface Settings {
  // Data Management
  logRetentionDays: number;
  taskRetentionDays: number;
  // Worker Settings
  maxConcurrentWorkers: number;
  defaultMaxRetries: number;
  taskCooldownSeconds: number;
  defaultWorkerModel: string;
  defaultWorkerPersona: string;
  // AI Provider Settings
  primaryProvider: string;
  // Ralph Execution Settings
  useRalphExecution: boolean;
  ralphMaxStories: number;
  // Cost Settings
  costAlertThresholdUsd: number | null;
  // Display Settings
  completedTaskDisplayMinutes: number;
  intermediateTaskDisplayMinutes: number;
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

export default function Settings() {
  const tokens = useAuthStore((state) => state.tokens);

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
    useRalphExecution: false,
    ralphMaxStories: 10,
    costAlertThresholdUsd: null,
    completedTaskDisplayMinutes: 10,
    intermediateTaskDisplayMinutes: 60,
  });
  const [originalSettings, setOriginalSettings] = useState<Settings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Jira settings
  const [jiraApiKey, setJiraApiKey] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraStatus, setJiraStatus] = useState<IntegrationStatus>({
    connected: false,
    lastChecked: null,
  });
  const [jiraVisible, setJiraVisible] = useState(false);
  const [jiraTesting, setJiraTesting] = useState(false);
  const [jiraSaving, setJiraSaving] = useState(false);
  const [_integrationsLoading, setIntegrationsLoading] = useState(true);

  // GitHub settings
  const [githubToken, setGithubToken] = useState("");
  const [githubDefaultRepo, setGithubDefaultRepo] = useState("");
  const [githubStatus, setGithubStatus] = useState<IntegrationStatus>({
    connected: false,
    lastChecked: null,
  });
  const [githubVisible, setGithubVisible] = useState(false);
  const [githubTesting, setGithubTesting] = useState(false);
  const [githubSaving, setGithubSaving] = useState(false);

  // Messages
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Team Members state
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamMembersLoading, setTeamMembersLoading] = useState(true);

  // Invites state
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
      { value: "gpt-4o", label: "GPT-4o", tier: "Powerful" },
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
      { value: "llama3.1:8b", label: "Llama 3.1 8B", tier: "Fast" },
      { value: "llama3.1:70b", label: "Llama 3.1 70B", tier: "Balanced" },
      { value: "codellama:34b", label: "Code Llama 34B", tier: "Balanced" },
      { value: "deepseek-coder:33b", label: "DeepSeek Coder 33B", tier: "Balanced" },
    ],
  };

  // Get models for current provider
  const currentModels = MODEL_OPTIONS[settings.primaryProvider] || MODEL_OPTIONS.anthropic;

  const PERSONA_OPTIONS = [
    { value: "frontend_developer", label: "Frontend Developer" },
    { value: "backend_developer", label: "Backend Developer" },
    { value: "devops_engineer", label: "DevOps Engineer" },
    { value: "security_engineer", label: "Security Engineer" },
    { value: "qa_engineer", label: "QA Engineer" },
    { value: "tech_writer", label: "Technical Writer" },
  ];

  // Fetch settings from API
  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings`, {
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
      });
      if (!response.ok) {
        throw new Error("Failed to load settings");
      }
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
        useRalphExecution: data.useRalphExecution ?? false,
        ralphMaxStories: data.ralphMaxStories ?? 10,
        costAlertThresholdUsd: data.costAlertThresholdUsd ?? null,
        completedTaskDisplayMinutes: data.completedTaskDisplayMinutes ?? 10,
        intermediateTaskDisplayMinutes: data.intermediateTaskDisplayMinutes ?? 60,
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

  // Fetch integration status from API
  const fetchIntegrations = useCallback(async () => {
    setIntegrationsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations`, {
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
      });
      if (!response.ok) {
        throw new Error("Failed to load integration status");
      }
      const data = await response.json();

      // Update Jira status
      setJiraStatus({
        connected: data.jira?.configured || false,
        lastChecked: new Date().toISOString(),
      });
      if (data.jira?.baseUrl) {
        setJiraBaseUrl(data.jira.baseUrl);
      }

      // Update GitHub status
      setGithubStatus({
        connected: data.github?.configured || false,
        lastChecked: new Date().toISOString(),
      });
      if (data.github?.defaultRepo) {
        setGithubDefaultRepo(data.github.defaultRepo);
      }
    } catch (err) {
      console.error("Failed to fetch integration status:", err);
    } finally {
      setIntegrationsLoading(false);
    }
  }, [tokens?.accessToken]);

  // Fetch team members
  const fetchTeamMembers = useCallback(async () => {
    if (!tokens?.accessToken) return;
    setTeamMembersLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/organizations/current/members`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
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

  // Fetch pending invites
  const fetchPendingInvites = useCallback(async () => {
    if (!tokens?.accessToken) return;
    setInvitesLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/organizations/current/invites`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
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

  // Fetch usage data
  const fetchUsageData = useCallback(async () => {
    if (!tokens?.accessToken) return;
    setUsageLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/billing/usage`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
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

  // Load settings on mount
  useEffect(() => {
    if (tokens?.accessToken) {
      fetchSettings();
      fetchIntegrations();
      fetchTeamMembers();
      fetchPendingInvites();
      fetchUsageData();
    }
  }, [tokens?.accessToken, fetchSettings, fetchIntegrations, fetchTeamMembers, fetchPendingInvites, fetchUsageData]);

  // Track unsaved changes
  useEffect(() => {
    if (originalSettings) {
      const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);
      setHasUnsavedChanges(hasChanges);
    }
  }, [settings, originalSettings]);

  // Validate settings
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
      errors.taskCooldownSeconds = "Must be between 0 and 86400 seconds (24 hours)";
    }

    if (settings.costAlertThresholdUsd !== null && settings.costAlertThresholdUsd < 0) {
      errors.costAlertThresholdUsd = "Must be a positive value or empty";
    }

    if (settings.completedTaskDisplayMinutes < 1 || settings.completedTaskDisplayMinutes > 60) {
      errors.completedTaskDisplayMinutes = "Must be between 1 and 60 minutes";
    }

    if (settings.intermediateTaskDisplayMinutes < 1 || settings.intermediateTaskDisplayMinutes > 1440) {
      errors.intermediateTaskDisplayMinutes = "Must be between 1 and 1440 minutes (24 hours)";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Save settings to API
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
      // API returns { success, message, settings: {...} }
      const savedSettings = data.settings || data;
      setOriginalSettings(savedSettings);
      setSettings(savedSettings);
      setMessage({ type: "success", text: data.message || "Settings saved successfully" });
      setHasUnsavedChanges(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save settings";
      setMessage({ type: "error", text: errorMessage });
    } finally {
      setSettingsSaving(false);
    }
  };

  // Update a single setting
  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    // Clear validation error for this field
    if (validationErrors[key as keyof ValidationErrors]) {
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[key as keyof ValidationErrors];
        return newErrors;
      });
    }
  };

  const handleTestJira = async () => {
    setJiraTesting(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/jira/test`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Jira connection failed");
      }

      setJiraStatus({ connected: true, lastChecked: new Date().toISOString() });
      setMessage({ type: "success", text: `Jira connection successful (${data.user})` });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Jira connection failed";
      setMessage({ type: "error", text: errorMessage });
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
        body: JSON.stringify({
          baseUrl: jiraBaseUrl,
          email: jiraEmail,
          apiToken: jiraApiKey,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save Jira credentials");
      }

      setMessage({ type: "success", text: "Jira settings saved successfully" });
      // Clear the sensitive fields after save
      setJiraApiKey("");
      // Refresh integration status
      fetchIntegrations();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save Jira credentials";
      setMessage({ type: "error", text: errorMessage });
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
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "GitHub connection failed");
      }

      setGithubStatus({ connected: true, lastChecked: new Date().toISOString() });
      setMessage({ type: "success", text: `GitHub connection successful (${data.user})` });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "GitHub connection failed";
      setMessage({ type: "error", text: errorMessage });
      setGithubStatus({ connected: false, lastChecked: new Date().toISOString() });
    } finally {
      setGithubTesting(false);
    }
  };

  const handleSaveGithub = async () => {
    setGithubSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/github`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: githubToken,
          defaultRepo: githubDefaultRepo,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save GitHub credentials");
      }

      setMessage({ type: "success", text: "GitHub settings saved successfully" });
      // Clear the sensitive fields after save
      setGithubToken("");
      // Refresh integration status
      fetchIntegrations();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save GitHub credentials";
      setMessage({ type: "error", text: errorMessage });
    } finally {
      setGithubSaving(false);
    }
  };

  const formatCooldownDisplay = (seconds: number): string => {
    if (seconds < 60) return `${seconds} seconds`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
    return `${Math.floor(seconds / 3600)} hours`;
  };

  // Handle sending invite
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
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send invite");
      }

      setMessage({ type: "success", text: `Invite sent to ${inviteEmail}` });
      setShowInviteModal(false);
      setInviteEmail("");
      setInviteRole("member");
      fetchPendingInvites();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to send invite";
      setMessage({ type: "error", text: errorMessage });
    } finally {
      setInviteSending(false);
    }
  };

  // Handle revoking invite
  const handleRevokeInvite = async (inviteId: string) => {
    setRevokingInviteId(inviteId);
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE}/api/organizations/current/invites/${inviteId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to revoke invite");
      }

      setMessage({ type: "success", text: "Invite revoked successfully" });
      fetchPendingInvites();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to revoke invite";
      setMessage({ type: "error", text: errorMessage });
    } finally {
      setRevokingInviteId(null);
    }
  };

  // Handle testing Slack webhook
  const handleTestSlackWebhook = async () => {
    setSlackWebhookTesting(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE}/api/settings/integrations/slack/test`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens?.accessToken}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Slack webhook test failed");
      }

      setMessage({ type: "success", text: "Slack webhook test successful! Check your Slack channel." });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Slack webhook test failed";
      setMessage({ type: "error", text: errorMessage });
    } finally {
      setSlackWebhookTesting(false);
    }
  };

  // Format date helper
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Get role badge color
  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "admin":
        return "bg-purple-500/20 text-purple-500";
      case "member":
        return "bg-blue-500/20 text-blue-500";
      case "viewer":
        return "bg-gray-500/20 text-gray-400";
      default:
        return "bg-gray-500/20 text-gray-400";
    }
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none opacity-50" />
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />

      {/* Header */}
      <header className="border-b border-border/30 glass-strong sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>
          </div>
          {hasUnsavedChanges && (
            <div className="flex items-center gap-2 text-yellow-500 text-sm">
              <AlertTriangle className="w-4 h-4" />
              Unsaved changes
            </div>
          )}
        </div>
      </header>

      <main className="relative max-w-4xl mx-auto p-6 space-y-6">
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>

        {message && (
          <div
            className={`p-4 rounded-lg border ${
              message.type === "success"
                ? "bg-green-500/10 border-green-500/30 text-green-500"
                : "bg-red-500/10 border-red-500/30 text-red-500"
            }`}
          >
            {message.text}
          </div>
        )}

        {settingsError && (
          <div className="p-4 rounded-lg border bg-yellow-500/10 border-yellow-500/30 text-yellow-500">
            {settingsError}
          </div>
        )}

        {/* Usage Display Section */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-green-500/10 to-transparent">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-green-500" />
              </div>
              Usage
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Track your task usage this billing period
            </p>
          </div>

          <div className="p-6">
            {usageLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">Loading usage data...</span>
              </div>
            ) : usageData ? (
              <div className="space-y-4">
                {/* Task Usage */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-foreground">Tasks this month</span>
                    <span className="text-sm text-muted-foreground">
                      {usageData.tasks.isUnlimited ? (
                        <>{usageData.tasks.used} / Unlimited</>
                      ) : (
                        <>
                          {usageData.tasks.used} / {usageData.tasks.quota} tasks
                        </>
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

                {/* Warning if near quota */}
                {!usageData.tasks.isUnlimited && usageData.tasks.percent >= 90 && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    <span>
                      You&apos;ve used {usageData.tasks.percent}% of your monthly task quota.
                      Consider upgrading your plan.
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-4">Unable to load usage data</p>
            )}
          </div>
        </div>

        {/* Team Members Section */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-indigo-500/10 to-transparent flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                  <Users className="w-4 h-4 text-indigo-500" />
                </div>
                Team Members
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Manage your organization&apos;s team
              </p>
            </div>
            <button
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500 text-white text-sm font-semibold rounded-lg hover:bg-indigo-600 transition-all"
            >
              <UserPlus className="w-4 h-4" />
              Invite Member
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* Current Members */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Current Members</h3>
              {teamMembersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <span className="ml-2 text-muted-foreground">Loading team members...</span>
                </div>
              ) : teamMembers.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No team members yet. Invite someone to get started.
                </p>
              ) : (
                <div className="space-y-2">
                  {teamMembers.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-4 bg-background/50 rounded-lg border border-border"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center">
                          <span className="text-indigo-500 font-semibold">
                            {(member.fullName || member.email).charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-foreground">
                            {member.fullName || member.email}
                          </p>
                          <p className="text-sm text-muted-foreground">{member.email}</p>
                        </div>
                      </div>
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${getRoleBadgeColor(member.role)}`}
                      >
                        {member.role}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pending Invites */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Pending Invites</h3>
              {invitesLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : pendingInvites.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No pending invites</p>
              ) : (
                <div className="space-y-2">
                  {pendingInvites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex items-center justify-between p-3 bg-yellow-500/5 rounded-lg border border-yellow-500/20"
                    >
                      <div className="flex items-center gap-3">
                        <Mail className="w-4 h-4 text-yellow-500" />
                        <div>
                          <p className="text-sm font-medium text-foreground">{invite.email}</p>
                          <p className="text-xs text-muted-foreground">
                            Expires {formatDate(invite.expiresAt)} | Role:{" "}
                            <span className="capitalize">{invite.role}</span>
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRevokeInvite(invite.id)}
                        disabled={revokingInviteId === invite.id}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                      >
                        {revokingInviteId === invite.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Data Management Section */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-blue-500/10 to-transparent">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Database className="w-4 h-4 text-blue-500" />
              </div>
              Data Management
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Configure data retention policies
            </p>
          </div>

          <div className="p-6 space-y-6">
            {settingsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">Loading settings...</span>
              </div>
            ) : (
              <>
                {/* Log Retention */}
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Log Retention Period
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
                        className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all text-center"
                      />
                    </div>
                    <span className="text-sm text-muted-foreground w-12">days</span>
                  </div>
                  {validationErrors.logRetentionDays && (
                    <p className="text-xs text-red-500 mt-1">{validationErrors.logRetentionDays}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Worker logs older than this will be automatically deleted (1-365 days)
                  </p>
                </div>

                {/* Task Retention */}
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Task History Retention
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
                        className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all text-center"
                      />
                    </div>
                    <span className="text-sm text-muted-foreground w-12">days</span>
                  </div>
                  {validationErrors.taskRetentionDays && (
                    <p className="text-xs text-red-500 mt-1">{validationErrors.taskRetentionDays}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Completed task records older than this will be archived (1-730 days)
                  </p>
                </div>

                {/* Completed Task Display Duration */}
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Completed Task Display Duration
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="1"
                      max="60"
                      value={settings.completedTaskDisplayMinutes}
                      onChange={(e) => updateSetting("completedTaskDisplayMinutes", parseInt(e.target.value))}
                      className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <div className="w-24">
                      <input
                        type="number"
                        min="1"
                        max="60"
                        value={settings.completedTaskDisplayMinutes}
                        onChange={(e) => updateSetting("completedTaskDisplayMinutes", parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all text-center"
                      />
                    </div>
                    <span className="text-sm text-muted-foreground w-12">min</span>
                  </div>
                  {validationErrors.completedTaskDisplayMinutes && (
                    <p className="text-xs text-red-500 mt-1">{validationErrors.completedTaskDisplayMinutes}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    How long completed tasks remain visible on the dashboard (1-60 minutes)
                  </p>
                </div>

                {/* Intermediate Task Display Duration */}
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    In-Progress Task Display Duration
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="1"
                      max="1440"
                      step="15"
                      value={settings.intermediateTaskDisplayMinutes}
                      onChange={(e) => updateSetting("intermediateTaskDisplayMinutes", parseInt(e.target.value))}
                      className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <div className="w-24">
                      <input
                        type="number"
                        min="1"
                        max="1440"
                        value={settings.intermediateTaskDisplayMinutes}
                        onChange={(e) => updateSetting("intermediateTaskDisplayMinutes", parseInt(e.target.value) || 1)}
                        className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all text-center"
                      />
                    </div>
                    <span className="text-sm text-muted-foreground w-12">min</span>
                  </div>
                  {validationErrors.intermediateTaskDisplayMinutes && (
                    <p className="text-xs text-red-500 mt-1">{validationErrors.intermediateTaskDisplayMinutes}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    How long tasks in progress (PR created, awaiting review, etc.) remain visible (1-1440 minutes / 24 hours)
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Worker Settings Section */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-accent/10 to-transparent">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
                <Cpu className="w-4 h-4 text-accent" />
              </div>
              Worker Settings
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Configure AI worker behavior and defaults
            </p>
          </div>

          <div className="p-6 space-y-6">
            {settingsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">Loading settings...</span>
              </div>
            ) : (
              <>
                {/* Max Concurrent Workers */}
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Max Concurrent Workers
                  </label>
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
                        className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all text-center"
                      />
                    </div>
                  </div>
                  {validationErrors.maxConcurrentWorkers && (
                    <p className="text-xs text-red-500 mt-1">{validationErrors.maxConcurrentWorkers}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Maximum number of workers that can run simultaneously (1-10)
                  </p>
                </div>

                {/* Task Cooldown */}
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                    <Sliders className="w-4 h-4" />
                    Task Cooldown Period
                  </label>
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
                        className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all text-center"
                      />
                    </div>
                    <span className="text-sm text-muted-foreground w-16">sec</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Wait time between task completions: {formatCooldownDisplay(settings.taskCooldownSeconds)} (0-86400 seconds)
                  </p>
                </div>

                {/* Max Retries */}
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" />
                    Default Max Retries
                  </label>
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
                        className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all text-center"
                      />
                    </div>
                  </div>
                  {validationErrors.defaultMaxRetries && (
                    <p className="text-xs text-red-500 mt-1">{validationErrors.defaultMaxRetries}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Number of automatic retries for failed tasks (0-10)
                  </p>
                </div>

                {/* AI Provider Selection */}
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-3">
                    Default AI Provider
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {PROVIDER_OPTIONS.map((provider) => (
                      <button
                        key={provider.value}
                        onClick={() => {
                          updateSetting("primaryProvider", provider.value);
                          // Auto-select first model of new provider if current model is invalid
                          const newProviderModels = MODEL_OPTIONS[provider.value];
                          if (newProviderModels && !newProviderModels.find(m => m.value === settings.defaultWorkerModel)) {
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
                  <p className="text-xs text-muted-foreground mt-2">
                    Default provider for new worker tasks. Override per-task with Jira labels (anthropic, openai, gemini, ollama).
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {/* Default Model */}
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">
                      Default Model
                    </label>
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
                    <p className="text-xs text-muted-foreground mt-1">
                      Available models for {PROVIDER_OPTIONS.find(p => p.value === settings.primaryProvider)?.label || "selected provider"}
                    </p>
                  </div>

                  {/* Default Persona */}
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">
                      Default Persona
                    </label>
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
                    <p className="text-xs text-muted-foreground mt-1">
                      Used when no persona is specified in the task
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Ralph Execution Settings Section */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-purple-500/10 to-transparent">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-purple-500" />
              </div>
              Ralph Execution Engine
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Advanced PRD-to-code execution for complex multi-step tasks
            </p>
          </div>

          <div className="p-6 space-y-6">
            {settingsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">Loading settings...</span>
              </div>
            ) : (
              <>
                {/* Enable Ralph Execution */}
                <div className="flex items-center justify-between p-4 rounded-lg bg-background/50 border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                      <FileText className="w-5 h-5 text-purple-500" />
                    </div>
                    <div>
                      <h3 className="font-medium text-foreground">Enable Ralph Mode</h3>
                      <p className="text-sm text-muted-foreground">
                        Use PRD generation and story-based execution for complex tasks
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => updateSetting("useRalphExecution", !settings.useRalphExecution)}
                    className={`relative w-14 h-7 rounded-full transition-colors ${
                      settings.useRalphExecution ? "bg-purple-500" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${
                        settings.useRalphExecution ? "translate-x-7" : ""
                      }`}
                    />
                  </button>
                </div>

                {/* Max Stories */}
                {settings.useRalphExecution && (
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Maximum Stories per PRD
                    </label>
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min="1"
                        max="50"
                        value={settings.ralphMaxStories}
                        onChange={(e) => updateSetting("ralphMaxStories", parseInt(e.target.value))}
                        className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-purple-500"
                      />
                      <div className="w-20">
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={settings.ralphMaxStories}
                          onChange={(e) => updateSetting("ralphMaxStories", parseInt(e.target.value) || 1)}
                          className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all text-center"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Maximum number of user stories Ralph will generate from a single PRD (1-50)
                    </p>
                  </div>
                )}

                <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
                  <h4 className="text-sm font-medium text-purple-400 mb-2">What is Ralph?</h4>
                  <p className="text-xs text-muted-foreground">
                    Ralph is an advanced execution engine that transforms high-level requirements into
                    detailed implementation plans. When enabled, complex tasks are broken down into
                    PRDs (Product Requirement Documents), then into individual user stories that
                    workers execute sequentially. This is ideal for large features that span multiple
                    files and require careful planning.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Cost Settings Section */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-yellow-500/10 to-transparent">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-yellow-500" />
              </div>
              Cost Settings
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Configure cost monitoring and alerts
            </p>
          </div>

          <div className="p-6 space-y-6">
            {settingsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">Loading settings...</span>
              </div>
            ) : (
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
                    className="w-full max-w-xs px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                  />
                </div>
                {validationErrors.costAlertThresholdUsd && (
                  <p className="text-xs text-red-500 mt-1">{validationErrors.costAlertThresholdUsd}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Get notified when accumulated costs exceed this amount. Leave empty to disable alerts.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Save Settings Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSaveSettings}
            disabled={settingsSaving || settingsLoading || !hasUnsavedChanges}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-lg hover:shadow-primary/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {settingsSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {settingsSaving ? "Saving..." : "Save All Settings"}
          </button>
        </div>

        {/* Integrations Section */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-primary/10 to-transparent">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <Key className="w-4 h-4 text-primary" />
              </div>
              Integrations
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Connect your development tools
            </p>
          </div>

          <div className="p-6 space-y-8">
            {/* Jira Integration */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <svg
                      viewBox="0 0 24 24"
                      className="w-6 h-6 text-blue-500"
                      fill="currentColor"
                    >
                      <path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53zM6.77 6.8a4.362 4.362 0 0 0 4.34 4.34h1.8v1.72a4.362 4.362 0 0 0 4.34 4.34V7.63a.84.84 0 0 0-.83-.83H6.77zM2 11.6c0 2.4 1.94 4.35 4.35 4.35h1.78v1.7c.01 2.39 1.95 4.34 4.34 4.35v-9.57a.84.84 0 0 0-.84-.83H2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">Jira</h3>
                    <p className="text-sm text-muted-foreground">
                      Connect to your Jira project for task management
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {jiraStatus.connected ? (
                    <span className="flex items-center gap-1 text-green-500 text-sm">
                      <CheckCircle className="w-4 h-4" />
                      Connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground text-sm">
                      <XCircle className="w-4 h-4" />
                      Not connected
                    </span>
                  )}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={jiraBaseUrl}
                    onChange={(e) => setJiraBaseUrl(e.target.value)}
                    placeholder="https://your-domain.atlassian.net"
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={jiraEmail}
                    onChange={(e) => setJiraEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    API Token
                  </label>
                  <div className="relative">
                    <input
                      type={jiraVisible ? "text" : "password"}
                      value={jiraApiKey}
                      onChange={(e) => setJiraApiKey(e.target.value)}
                      placeholder={jiraStatus.connected ? "••••••••••••" : "Enter your Jira API token"}
                      className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setJiraVisible(!jiraVisible)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {jiraVisible ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleTestJira}
                  disabled={jiraTesting || !jiraStatus.connected}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {jiraTesting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  Test Connection
                </button>
                <button
                  onClick={handleSaveJira}
                  disabled={jiraSaving || !jiraApiKey || !jiraBaseUrl || !jiraEmail}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
                >
                  {jiraSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save
                </button>
              </div>
            </div>

            <div className="border-t border-border/50" />

            {/* GitHub Integration */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gray-500/10 flex items-center justify-center">
                    <Github className="w-6 h-6 text-foreground" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">GitHub</h3>
                    <p className="text-sm text-muted-foreground">
                      Connect to GitHub for code management and PRs
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {githubStatus.connected ? (
                    <span className="flex items-center gap-1 text-green-500 text-sm">
                      <CheckCircle className="w-4 h-4" />
                      Connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground text-sm">
                      <XCircle className="w-4 h-4" />
                      Not connected
                    </span>
                  )}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Personal Access Token
                  </label>
                  <div className="relative">
                    <input
                      type={githubVisible ? "text" : "password"}
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      placeholder={githubStatus.connected ? "••••••••••••" : "ghp_xxxxxxxxxxxx"}
                      className="w-full px-4 py-3 pr-10 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setGithubVisible(!githubVisible)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {githubVisible ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <a
                    href="https://github.com/settings/tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
                  >
                    Generate a token
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-2">
                    Default Repository
                  </label>
                  <input
                    type="text"
                    value={githubDefaultRepo}
                    onChange={(e) => setGithubDefaultRepo(e.target.value)}
                    placeholder="owner/repository"
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleTestGithub}
                  disabled={githubTesting || !githubStatus.connected}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {githubTesting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  Test Connection
                </button>
                <button
                  onClick={handleSaveGithub}
                  disabled={githubSaving || !githubToken}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {githubSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save
                </button>
              </div>
            </div>

            <div className="border-t border-border/50" />

            {/* Slack Notifications */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                    <Bell className="w-6 h-6 text-purple-500" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">Slack Notifications</h3>
                    <p className="text-sm text-muted-foreground">
                      Get notified about task completions and failures
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-muted/30 border border-border">
                <p className="text-sm text-muted-foreground mb-3">
                  Slack webhook URL is configured in your organization settings. Use the button below
                  to send a test notification to verify the integration is working.
                </p>
                <button
                  onClick={handleTestSlackWebhook}
                  disabled={slackWebhookTesting}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50"
                >
                  {slackWebhookTesting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Test Webhook
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Organization Section */}
        <div className="card-elevated border border-border/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 bg-gradient-to-r from-purple-500/10 to-transparent">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Building className="w-4 h-4 text-purple-500" />
              </div>
              Organization
            </h2>
          </div>

          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Organization Name
              </label>
              <input
                type="text"
                value="WorkerMill Inc."
                disabled
                className="w-full px-4 py-3 rounded-xl bg-muted/30 border border-border text-muted-foreground cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Plan
              </label>
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 text-sm font-medium rounded-full bg-primary/20 text-primary">
                  Early Access
                </span>
                <a
                  href="#"
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                >
                  View billing
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>

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
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteEmail("");
                  setInviteRole("member");
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "member" | "viewer")}
                  className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
                >
                  <option value="admin">Admin - Full access and settings management</option>
                  <option value="member">Member - Create and manage tasks</option>
                  <option value="viewer">Viewer - View only access</option>
                </select>
              </div>

              <div className="p-3 rounded-lg bg-muted/30 border border-border">
                <p className="text-xs text-muted-foreground">
                  An invitation email will be sent with a link to join your organization. The invite
                  expires in 7 days.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteEmail("");
                  setInviteRole("member");
                }}
                className="flex-1 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSendInvite}
                disabled={inviteSending || !inviteEmail.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-500 text-white font-semibold rounded-lg hover:bg-indigo-600 transition-all disabled:opacity-50"
              >
                {inviteSending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Send Invite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
