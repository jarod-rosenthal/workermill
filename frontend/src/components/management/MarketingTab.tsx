import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Play,
  Eye,
  Clock,
  TrendingUp,
  DollarSign,
  MousePointer,
  Target,
  BarChart3,
  Megaphone,
  Plus,
  ChevronDown,
  ChevronRight,
  Save,
  Settings,
  Shield,
  Key,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "";

// --- Types ---

interface MarketingStats {
  monthlyBudget: number;
  spent: number;
  impressions: number;
  clicks: number;
  conversions: number;
  avgCpa: number;
  agentEnabled: boolean;
  agentIntervalMinutes: number;
}

interface Campaign {
  id: string;
  name: string;
  platform: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpa: number;
}

interface ContentItem {
  id: string;
  platform: string;
  contentType: string;
  title: string;
  body: string;
  status: string;
  createdAt: string;
}

interface ActionItem {
  id: string;
  type: string;
  platform: string;
  description: string;
  automated: boolean;
  createdAt: string;
}

interface MarketingConfig {
  enabled: boolean;
  intervalMinutes: number;
  monthlyBudgetCents: number;
  escalationThresholdCents: number;
  config: Record<string, unknown>;
  channels: Record<string, { enabled: boolean }>;
}

interface ConfigFormState {
  // Agent settings
  enabled: boolean;
  intervalMinutes: number;
  missionTimeWindowStart: string;
  missionTimeWindowEnd: string;
  maxMissionsPerDay: number;
  aiModel: string;
  voiceTone: string;
  brandKeywords: string;
  competitorKeywords: string;

  // Budget & Spend
  monthlyBudgetDollars: string;
  dailySpendLimitDollars: string;
  perCampaignMaxSpendDollars: string;
  autoApproveSpendThresholdDollars: string;
  budgetPauseThresholdPct: number;
  budgetAlertThresholdPct: number;

  // Guardrails
  autoPublishRoutineContent: boolean;
  autoAdjustBids: boolean;
  maxBidAdjustmentPct: number;
  autoPauseUnderperformers: boolean;
  cpaCeilingDollars: string;

  // Channel credentials
  channelCredentials: Record<
    string,
    { enabled: boolean; apiKey: string }
  >;
}

const CHANNEL_PLATFORMS = [
  { key: "google_ads", label: "Google Ads" },
  { key: "reddit", label: "Reddit" },
  { key: "x", label: "X (Twitter)" },
  { key: "devto", label: "Dev.to" },
  { key: "hackernews", label: "Hacker News" },
] as const;

const CAMPAIGN_PLATFORMS = [
  "google_ads",
  "reddit",
  "x",
  "devto",
  "hackernews",
] as const;

const CONTENT_PLATFORMS = ["x", "reddit", "devto", "hackernews"] as const;

const CONTENT_TYPES = ["tweet", "post", "article", "ad_copy"] as const;

// --- Helpers ---

const PLATFORM_NAMES: Record<string, string> = {
  google_ads: "Google",
  reddit: "Reddit",
  x: "X",
  devto: "Dev.to",
  hackernews: "HN",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-green-500 border-green-500/20",
  paused: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  pending_review: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  completed: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  rejected: "bg-red-500/10 text-red-500 border-red-500/20",
  published: "bg-green-500/10 text-green-500 border-green-500/20",
  draft: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

const ACTION_TYPE_COLORS: Record<string, string> = {
  bid_adjustment: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  content_created: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  campaign_paused: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  campaign_started: "bg-green-500/10 text-green-500 border-green-500/20",
  budget_reallocated:
    "bg-orange-500/10 text-orange-500 border-orange-500/20",
  escalation: "bg-red-500/10 text-red-500 border-red-500/20",
};

function platformName(key: string): string {
  return PLATFORM_NAMES[key] || key;
}

function statusBadge(status: string) {
  const color =
    STATUS_COLORS[status] ||
    "bg-gray-500/10 text-gray-500 border-gray-500/20";
  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full border ${color}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function actionTypeBadge(type: string) {
  const color =
    ACTION_TYPE_COLORS[type] ||
    "bg-gray-500/10 text-gray-500 border-gray-500/20";
  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full border ${color}`}
    >
      {type.replace(/_/g, " ")}
    </span>
  );
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dollarsToCents(dollars: string): number {
  const parsed = parseFloat(dollars);
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * 100);
}

// --- Reusable sub-components ---

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
        checked ? "bg-blue-600" : "bg-gray-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
      {label && (
        <span className="sr-only">{label}</span>
      )}
    </button>
  );
}

function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-6 py-4 flex items-center gap-3 hover:bg-muted/30 transition-colors cursor-pointer"
      >
        {icon}
        <h3 className="text-md font-semibold text-foreground">{title}</h3>
        <span className="ml-auto text-muted-foreground">
          {open ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </span>
      </button>
      {open && <div className="px-6 pb-6 space-y-4">{children}</div>}
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const INPUT_CLASS =
  "w-full bg-muted/50 border border-border rounded px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500";
const SELECT_CLASS =
  "w-full bg-muted/50 border border-border rounded px-3 py-2 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 cursor-pointer";

// --- Component ---

type SubTab = "campaigns" | "content" | "actions" | "config";

export function MarketingTab({ accessToken }: { accessToken: string }) {
  const [subTab, setSubTab] = useState<SubTab>("campaigns");
  const [stats, setStats] = useState<MarketingStats | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Config form state
  const [configForm, setConfigForm] = useState<ConfigFormState | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  // Create campaign form state
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignPlatform, setNewCampaignPlatform] = useState<string>(
    CAMPAIGN_PLATFORMS[0],
  );
  const [newCampaignBudget, setNewCampaignBudget] = useState("");
  const [campaignCreating, setCampaignCreating] = useState(false);

  // Create content form state
  const [showNewContent, setShowNewContent] = useState(false);
  const [newContentPlatform, setNewContentPlatform] = useState<string>(
    CONTENT_PLATFORMS[0],
  );
  const [newContentType, setNewContentType] = useState<string>(
    CONTENT_TYPES[0],
  );
  const [newContentTitle, setNewContentTitle] = useState("");
  const [newContentBody, setNewContentBody] = useState("");
  const [contentCreating, setContentCreating] = useState(false);

  const headers = { Authorization: `Bearer ${accessToken}` };
  const jsonHeaders = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);

      const [statsRes, campaignsRes, contentRes, actionsRes] =
        await Promise.all([
          fetch(`${API_BASE}/api/marketing/stats`, { headers }),
          fetch(`${API_BASE}/api/marketing/campaigns`, { headers }),
          fetch(`${API_BASE}/api/marketing/content`, { headers }),
          fetch(`${API_BASE}/api/marketing/actions`, { headers }),
        ]);

      const [statsData, campaignsData, contentData, actionsData] =
        await Promise.all([
          statsRes.ok ? statsRes.json() : null,
          campaignsRes.ok ? campaignsRes.json() : { campaigns: [] },
          contentRes.ok ? contentRes.json() : { content: [] },
          actionsRes.ok ? actionsRes.json() : { actions: [] },
        ]);

      if (statsData) setStats(statsData);
      setCampaigns(campaignsData.campaigns ?? []);
      setContent(contentData.content ?? []);
      setActions(actionsData.actions ?? []);
    } catch (err) {
      console.error("Failed to fetch marketing data:", err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Fetch config when switching to config tab
  const fetchConfig = useCallback(async () => {
    try {
      setConfigLoading(true);
      const res = await fetch(`${API_BASE}/api/marketing/config`, {
        headers,
      });
      if (!res.ok) return;
      const data: MarketingConfig = await res.json();

      const cfg = data.config || {};
      const timeWindow =
        (cfg.missionTimeWindow as string) || "06:00-22:00";
      const [startTime, endTime] = timeWindow.split("-");

      setConfigForm({
        enabled: data.enabled,
        intervalMinutes: data.intervalMinutes,
        missionTimeWindowStart: startTime || "06:00",
        missionTimeWindowEnd: endTime || "22:00",
        maxMissionsPerDay: (cfg.maxMissionsPerDay as number) || 12,
        aiModel: (cfg.aiModel as string) || "",
        voiceTone: (cfg.voiceTone as string) || "",
        brandKeywords: Array.isArray(cfg.brandKeywords)
          ? (cfg.brandKeywords as string[]).join(", ")
          : "",
        competitorKeywords: Array.isArray(cfg.competitorKeywords)
          ? (cfg.competitorKeywords as string[]).join(", ")
          : "",

        monthlyBudgetDollars: centsToDollars(data.monthlyBudgetCents),
        dailySpendLimitDollars: centsToDollars(
          (cfg.dailySpendLimitCents as number) || 0,
        ),
        perCampaignMaxSpendDollars: centsToDollars(
          (cfg.perCampaignMaxSpendCents as number) || 0,
        ),
        autoApproveSpendThresholdDollars: centsToDollars(
          data.escalationThresholdCents,
        ),
        budgetPauseThresholdPct:
          (cfg.budgetPauseThresholdPct as number) || 90,
        budgetAlertThresholdPct:
          (cfg.budgetAlertThresholdPct as number) || 75,

        autoPublishRoutineContent:
          (cfg.autoPublishRoutineContent as boolean) !== false,
        autoAdjustBids: (cfg.autoAdjustBids as boolean) !== false,
        maxBidAdjustmentPct:
          (cfg.maxBidAdjustmentPct as number) || 15,
        autoPauseUnderperformers:
          (cfg.autoPauseUnderperformers as boolean) !== false,
        cpaCeilingDollars: centsToDollars(
          (cfg.cpaCeilingCents as number) || 0,
        ),

        channelCredentials: Object.fromEntries(
          CHANNEL_PLATFORMS.map(({ key }) => [
            key,
            {
              enabled: data.channels?.[key]?.enabled || false,
              apiKey: "",
            },
          ]),
        ),
      });
    } catch (err) {
      console.error("Failed to fetch marketing config:", err);
    } finally {
      setConfigLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (subTab === "config" && !configForm) {
      fetchConfig();
    }
  }, [subTab, configForm, fetchConfig]);

  // --- Handlers ---

  const handleApprove = async (id: string) => {
    await fetch(`${API_BASE}/api/marketing/content/${id}/approve`, {
      method: "POST",
      headers,
    });
    await fetchAll();
  };

  const handleReject = async (id: string) => {
    await fetch(`${API_BASE}/api/marketing/content/${id}/reject`, {
      method: "POST",
      headers,
    });
    await fetchAll();
  };

  const handleRunNow = async () => {
    await fetch(`${API_BASE}/api/marketing/run-now`, {
      method: "POST",
      headers,
    });
    setTimeout(() => fetchAll(), 3000);
  };

  const handleSaveConfig = async () => {
    if (!configForm) return;
    setConfigSaving(true);
    setConfigSaved(false);

    try {
      const brandKeywordsArr = configForm.brandKeywords
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const competitorKeywordsArr = configForm.competitorKeywords
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // Build credentials object — only include channels with a non-empty apiKey
      const credentials: Record<string, { apiKey: string }> = {};
      for (const [channel, cred] of Object.entries(
        configForm.channelCredentials,
      )) {
        if (cred.apiKey) {
          credentials[channel] = { apiKey: cred.apiKey };
        }
      }

      const body = {
        enabled: configForm.enabled,
        intervalMinutes: configForm.intervalMinutes,
        monthlyBudgetCents: dollarsToCents(
          configForm.monthlyBudgetDollars,
        ),
        escalationThresholdCents: dollarsToCents(
          configForm.autoApproveSpendThresholdDollars,
        ),
        config: {
          missionTimeWindow: `${configForm.missionTimeWindowStart}-${configForm.missionTimeWindowEnd}`,
          maxMissionsPerDay: configForm.maxMissionsPerDay,
          aiModel: configForm.aiModel || undefined,
          voiceTone: configForm.voiceTone || undefined,
          brandKeywords:
            brandKeywordsArr.length > 0 ? brandKeywordsArr : undefined,
          competitorKeywords:
            competitorKeywordsArr.length > 0
              ? competitorKeywordsArr
              : undefined,
          dailySpendLimitCents: dollarsToCents(
            configForm.dailySpendLimitDollars,
          ),
          perCampaignMaxSpendCents: dollarsToCents(
            configForm.perCampaignMaxSpendDollars,
          ),
          budgetPauseThresholdPct: configForm.budgetPauseThresholdPct,
          budgetAlertThresholdPct: configForm.budgetAlertThresholdPct,
          autoPublishRoutineContent:
            configForm.autoPublishRoutineContent,
          autoAdjustBids: configForm.autoAdjustBids,
          maxBidAdjustmentPct: configForm.maxBidAdjustmentPct,
          autoPauseUnderperformers:
            configForm.autoPauseUnderperformers,
          cpaCeilingCents: dollarsToCents(configForm.cpaCeilingDollars),
        },
        ...(Object.keys(credentials).length > 0 && { credentials }),
      };

      await fetch(`${API_BASE}/api/marketing/config`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      });

      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save marketing config:", err);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleCreateCampaign = async () => {
    if (!newCampaignName.trim()) return;
    setCampaignCreating(true);
    try {
      await fetch(`${API_BASE}/api/marketing/campaigns`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: newCampaignName.trim(),
          platform: newCampaignPlatform,
          budgetCents: dollarsToCents(newCampaignBudget),
          status: "pending_review",
        }),
      });
      setShowNewCampaign(false);
      setNewCampaignName("");
      setNewCampaignBudget("");
      setNewCampaignPlatform(CAMPAIGN_PLATFORMS[0]);
      await fetchAll();
    } catch (err) {
      console.error("Failed to create campaign:", err);
    } finally {
      setCampaignCreating(false);
    }
  };

  const handleCreateContent = async () => {
    if (!newContentBody.trim()) return;
    setContentCreating(true);
    try {
      await fetch(`${API_BASE}/api/marketing/content`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          platform: newContentPlatform,
          contentType: newContentType,
          title: newContentTitle.trim() || null,
          body: newContentBody.trim(),
          status: "draft",
        }),
      });
      setShowNewContent(false);
      setNewContentPlatform(CONTENT_PLATFORMS[0]);
      setNewContentType(CONTENT_TYPES[0]);
      setNewContentTitle("");
      setNewContentBody("");
      await fetchAll();
    } catch (err) {
      console.error("Failed to create content:", err);
    } finally {
      setContentCreating(false);
    }
  };

  // Config form updater
  const updateConfig = (
    updates: Partial<ConfigFormState>,
  ) => {
    setConfigForm((prev) => (prev ? { ...prev, ...updates } : prev));
  };

  const updateChannelCred = (
    channel: string,
    field: "enabled" | "apiKey",
    value: boolean | string,
  ) => {
    setConfigForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        channelCredentials: {
          ...prev.channelCredentials,
          [channel]: {
            ...prev.channelCredentials[channel],
            [field]: value,
          },
        },
      };
    });
  };

  // --- Budget progress bar color ---

  const budgetPct =
    stats && stats.monthlyBudget > 0
      ? (stats.spent / stats.monthlyBudget) * 100
      : 0;

  const budgetBarColor =
    budgetPct > 90
      ? "bg-red-500"
      : budgetPct > 75
        ? "bg-yellow-500"
        : "bg-green-500";

  // --- Pending review items ---

  const pendingContent = content.filter(
    (c) => c.status === "pending_review",
  );

  // --- Loading state ---

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Budget summary bar */}
      {stats && (
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-6 mb-3">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-green-500" />
              <span className="text-sm text-muted-foreground">
                Monthly Budget
              </span>
              <span className="text-sm font-semibold text-foreground">
                {formatCurrency(stats.monthlyBudget)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-orange-500" />
              <span className="text-sm text-muted-foreground">Spent</span>
              <span className="text-sm font-semibold text-foreground">
                {formatCurrency(stats.spent)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">
                Impressions
              </span>
              <span className="text-sm font-semibold text-foreground">
                {formatNumber(stats.impressions)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <MousePointer className="w-4 h-4 text-purple-500" />
              <span className="text-sm text-muted-foreground">Clicks</span>
              <span className="text-sm font-semibold text-foreground">
                {formatNumber(stats.clicks)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-500" />
              <span className="text-sm text-muted-foreground">
                Conversions
              </span>
              <span className="text-sm font-semibold text-foreground">
                {formatNumber(stats.conversions)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-cyan-500" />
              <span className="text-sm text-muted-foreground">Avg CPA</span>
              <span className="text-sm font-semibold text-foreground">
                {formatCurrency(stats.avgCpa)}
              </span>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <span
                className={`px-2 py-0.5 text-xs font-medium rounded-full border ${stats.agentEnabled ? "bg-green-500/10 text-green-500 border-green-500/20" : "bg-gray-500/10 text-gray-500 border-gray-500/20"}`}
              >
                {stats.agentEnabled ? "Active" : "Disabled"}
              </span>
              <span className="text-xs text-muted-foreground">
                every {stats.agentIntervalMinutes}m
              </span>
              <button
                onClick={handleRunNow}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Play className="w-3 h-3" />
                Run Now
              </button>
            </div>
          </div>

          {/* Budget progress bar */}
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className={`${budgetBarColor} h-2 rounded-full transition-all`}
              style={{ width: `${Math.min(budgetPct, 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {budgetPct.toFixed(1)}% of budget used
          </p>
        </div>
      )}

      {/* Sub-tab navigation */}
      <div className="flex gap-1 border-b border-border">
        {(
          [
            ["campaigns", "Campaigns"],
            ["content", "Content"],
            ["actions", "Actions"],
            ["config", "Config"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              subTab === key
                ? "border-blue-500 text-blue-500"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}

      {subTab === "campaigns" && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">
              Campaigns ({campaigns.length})
            </h2>
            <button
              onClick={() => setShowNewCampaign(!showNewCampaign)}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              New Campaign
            </button>
          </div>

          {/* Inline create campaign form */}
          {showNewCampaign && (
            <div className="px-4 py-4 border-b border-border bg-muted/20">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <FormField label="Name">
                  <input
                    type="text"
                    value={newCampaignName}
                    onChange={(e) => setNewCampaignName(e.target.value)}
                    placeholder="Campaign name"
                    className={INPUT_CLASS}
                  />
                </FormField>
                <FormField label="Platform">
                  <select
                    value={newCampaignPlatform}
                    onChange={(e) =>
                      setNewCampaignPlatform(e.target.value)
                    }
                    className={SELECT_CLASS}
                  >
                    {CAMPAIGN_PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {platformName(p)}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Budget ($)">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={newCampaignBudget}
                    onChange={(e) => setNewCampaignBudget(e.target.value)}
                    placeholder="0.00"
                    className={INPUT_CLASS}
                  />
                </FormField>
                <div className="flex items-end gap-2">
                  <button
                    onClick={handleCreateCampaign}
                    disabled={
                      campaignCreating || !newCampaignName.trim()
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {campaignCreating ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Plus className="w-3 h-3" />
                    )}
                    Create
                  </button>
                  <button
                    onClick={() => setShowNewCampaign(false)}
                    className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {campaigns.length === 0 && !showNewCampaign ? (
            <div className="p-8 text-center">
              <Megaphone className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">No campaigns yet</p>
            </div>
          ) : campaigns.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Campaign
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Platform
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Spend
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Impressions
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Clicks
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Conv
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      CPA
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {campaigns.map((c) => (
                    <tr
                      key={c.id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-foreground">
                        {c.name}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded">
                          {platformName(c.platform)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {statusBadge(c.status)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">
                        {formatCurrency(c.spend)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">
                        {formatNumber(c.impressions)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">
                        {formatNumber(c.clicks)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">
                        {formatNumber(c.conversions)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground text-right">
                        {formatCurrency(c.cpa)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}

      {subTab === "content" && (
        <div className="space-y-6">
          {/* New content button + inline form */}
          <div className="bg-card rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Plus className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold text-foreground">
                Create Content
              </h2>
              <button
                onClick={() => setShowNewContent(!showNewContent)}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                New Content
              </button>
            </div>

            {showNewContent && (
              <div className="px-4 py-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <FormField label="Platform">
                    <select
                      value={newContentPlatform}
                      onChange={(e) =>
                        setNewContentPlatform(e.target.value)
                      }
                      className={SELECT_CLASS}
                    >
                      {CONTENT_PLATFORMS.map((p) => (
                        <option key={p} value={p}>
                          {platformName(p)}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Content Type">
                    <select
                      value={newContentType}
                      onChange={(e) =>
                        setNewContentType(e.target.value)
                      }
                      className={SELECT_CLASS}
                    >
                      {CONTENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Title (optional)">
                    <input
                      type="text"
                      value={newContentTitle}
                      onChange={(e) =>
                        setNewContentTitle(e.target.value)
                      }
                      placeholder="Content title"
                      className={INPUT_CLASS}
                    />
                  </FormField>
                </div>
                <FormField label="Body">
                  <textarea
                    value={newContentBody}
                    onChange={(e) => setNewContentBody(e.target.value)}
                    placeholder="Write your content here..."
                    rows={4}
                    className={`${INPUT_CLASS} resize-y`}
                  />
                </FormField>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCreateContent}
                    disabled={
                      contentCreating || !newContentBody.trim()
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {contentCreating ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Plus className="w-3 h-3" />
                    )}
                    Create as Draft
                  </button>
                  <button
                    onClick={() => setShowNewContent(false)}
                    className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Pending review section */}
          {pendingContent.length > 0 && (
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground">
                  Pending Review ({pendingContent.length})
                </h2>
              </div>
              <div className="divide-y divide-border">
                {pendingContent.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded">
                            {platformName(item.platform)}
                          </span>
                          <span className="px-1.5 py-0.5 text-xs bg-purple-500/10 text-purple-500 rounded">
                            {item.contentType}
                          </span>
                          {statusBadge(item.status)}
                        </div>
                        <p className="text-sm font-medium text-foreground">
                          {item.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {item.body}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleApprove(item.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500/20 border border-green-500/20 transition-colors"
                        >
                          <CheckCircle className="w-3 h-3" />
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(item.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                        >
                          <XCircle className="w-3 h-3" />
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All content timeline */}
          <div className="bg-card rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">
                All Content ({content.length})
              </h2>
            </div>
            {content.length === 0 ? (
              <div className="p-8 text-center">
                <Megaphone className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No content yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
                {content.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded">
                            {platformName(item.platform)}
                          </span>
                          <span className="px-1.5 py-0.5 text-xs bg-purple-500/10 text-purple-500 rounded">
                            {item.contentType}
                          </span>
                          {statusBadge(item.status)}
                          <span className="text-xs text-muted-foreground ml-auto">
                            {formatDate(item.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-foreground">
                          {item.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {item.body}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === "actions" && (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">
              Actions ({actions.length})
            </h2>
          </div>
          {actions.length === 0 ? (
            <div className="p-8 text-center">
              <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">No actions yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Time
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Platform
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Description
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Mode
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {actions.map((a) => (
                    <tr
                      key={a.id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                        {formatDate(a.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        {actionTypeBadge(a.type)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded">
                          {platformName(a.platform)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {a.description}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded-full border ${
                            a.automated
                              ? "bg-blue-500/10 text-blue-500 border-blue-500/20"
                              : "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                          }`}
                        >
                          {a.automated ? "Auto" : "Escalated"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === "config" && (
        <div className="space-y-4">
          {configLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : configForm ? (
            <>
              {/* Agent Settings */}
              <CollapsibleSection
                title="Agent Settings"
                icon={
                  <Settings className="w-4 h-4 text-blue-500" />
                }
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between col-span-full">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Agent Enabled
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Enable or disable the marketing agent
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={configForm.enabled}
                      onChange={(v) => updateConfig({ enabled: v })}
                      label="Agent enabled"
                    />
                  </div>

                  <FormField label="Mission Interval (minutes)">
                    <input
                      type="number"
                      min={1}
                      value={configForm.intervalMinutes}
                      onChange={(e) =>
                        updateConfig({
                          intervalMinutes:
                            parseInt(e.target.value, 10) || 1,
                        })
                      }
                      className={INPUT_CLASS}
                    />
                  </FormField>

                  <FormField label="Max Missions Per Day">
                    <input
                      type="number"
                      min={1}
                      value={configForm.maxMissionsPerDay}
                      onChange={(e) =>
                        updateConfig({
                          maxMissionsPerDay:
                            parseInt(e.target.value, 10) || 1,
                        })
                      }
                      className={INPUT_CLASS}
                    />
                  </FormField>

                  <FormField label="Mission Window Start (UTC)">
                    <input
                      type="time"
                      value={configForm.missionTimeWindowStart}
                      onChange={(e) =>
                        updateConfig({
                          missionTimeWindowStart: e.target.value,
                        })
                      }
                      className={INPUT_CLASS}
                    />
                  </FormField>

                  <FormField label="Mission Window End (UTC)">
                    <input
                      type="time"
                      value={configForm.missionTimeWindowEnd}
                      onChange={(e) =>
                        updateConfig({
                          missionTimeWindowEnd: e.target.value,
                        })
                      }
                      className={INPUT_CLASS}
                    />
                  </FormField>

                  <FormField label="AI Model">
                    <input
                      type="text"
                      value={configForm.aiModel}
                      onChange={(e) =>
                        updateConfig({ aiModel: e.target.value })
                      }
                      placeholder="e.g. claude-sonnet-4-6"
                      className={INPUT_CLASS}
                    />
                  </FormField>

                  <div className="col-span-full">
                    <FormField label="Voice / Tone Guidelines">
                      <textarea
                        value={configForm.voiceTone}
                        onChange={(e) =>
                          updateConfig({
                            voiceTone: e.target.value,
                          })
                        }
                        placeholder="Describe the brand voice and tone for generated content..."
                        rows={3}
                        className={`${INPUT_CLASS} resize-y`}
                      />
                    </FormField>
                  </div>

                  <FormField label="Brand Keywords (comma-separated)">
                    <input
                      type="text"
                      value={configForm.brandKeywords}
                      onChange={(e) =>
                        updateConfig({
                          brandKeywords: e.target.value,
                        })
                      }
                      placeholder="workermill, AI agents, automation"
                      className={INPUT_CLASS}
                    />
                  </FormField>

                  <FormField label="Competitor Keywords (comma-separated)">
                    <input
                      type="text"
                      value={configForm.competitorKeywords}
                      onChange={(e) =>
                        updateConfig({
                          competitorKeywords: e.target.value,
                        })
                      }
                      placeholder="devin, cursor, copilot"
                      className={INPUT_CLASS}
                    />
                  </FormField>
                </div>
              </CollapsibleSection>

              {/* Budget & Spend */}
              <CollapsibleSection
                title="Budget & Spend"
                icon={
                  <DollarSign className="w-4 h-4 text-green-500" />
                }
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Monthly Budget Cap ($)">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={configForm.monthlyBudgetDollars}
                      onChange={(e) =>
                        updateConfig({
                          monthlyBudgetDollars: e.target.value,
                        })
                      }
                      className={INPUT_CLASS}
                    />
                  </FormField>

                  <FormField label="Daily Spend Limit ($)">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={configForm.dailySpendLimitDollars}
                      onChange={(e) =>
                        updateConfig({
                          dailySpendLimitDollars: e.target.value,
                        })
                      }
                      className={INPUT_CLASS}
                    />
                  </FormField>

                  <FormField label="Per-Campaign Max Spend ($)">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={configForm.perCampaignMaxSpendDollars}
                      onChange={(e) =>
                        updateConfig({
                          perCampaignMaxSpendDollars: e.target.value,
                        })
                      }
                      className={INPUT_CLASS}
                    />
                  </FormField>

                  <FormField label="Auto-Approve Spend Threshold ($)">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={
                        configForm.autoApproveSpendThresholdDollars
                      }
                      onChange={(e) =>
                        updateConfig({
                          autoApproveSpendThresholdDollars:
                            e.target.value,
                        })
                      }
                      className={INPUT_CLASS}
                    />
                  </FormField>

                  <FormField
                    label={`Pause at Budget % (${configForm.budgetPauseThresholdPct}%)`}
                  >
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={configForm.budgetPauseThresholdPct}
                      onChange={(e) =>
                        updateConfig({
                          budgetPauseThresholdPct: parseInt(
                            e.target.value,
                            10,
                          ),
                        })
                      }
                      className="w-full accent-blue-600 cursor-pointer"
                    />
                  </FormField>

                  <FormField
                    label={`Budget Alert Threshold % (${configForm.budgetAlertThresholdPct}%)`}
                  >
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={configForm.budgetAlertThresholdPct}
                      onChange={(e) =>
                        updateConfig({
                          budgetAlertThresholdPct: parseInt(
                            e.target.value,
                            10,
                          ),
                        })
                      }
                      className="w-full accent-blue-600 cursor-pointer"
                    />
                  </FormField>
                </div>
              </CollapsibleSection>

              {/* Guardrails */}
              <CollapsibleSection
                title="Guardrails"
                icon={
                  <Shield className="w-4 h-4 text-yellow-500" />
                }
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Auto-Publish Routine Content
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Automatically publish tweets and short posts
                        without review
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={configForm.autoPublishRoutineContent}
                      onChange={(v) =>
                        updateConfig({
                          autoPublishRoutineContent: v,
                        })
                      }
                      label="Auto-publish routine content"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Auto-Adjust Bids
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Allow the agent to adjust ad bids
                        automatically
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={configForm.autoAdjustBids}
                      onChange={(v) =>
                        updateConfig({ autoAdjustBids: v })
                      }
                      label="Auto-adjust bids"
                    />
                  </div>

                  {configForm.autoAdjustBids && (
                    <div className="ml-8">
                      <FormField label="Max Bid Adjustment (%)">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={configForm.maxBidAdjustmentPct}
                          onChange={(e) =>
                            updateConfig({
                              maxBidAdjustmentPct:
                                parseInt(e.target.value, 10) || 1,
                            })
                          }
                          className={`${INPUT_CLASS} max-w-[200px]`}
                        />
                      </FormField>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Auto-Pause Underperformers
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Automatically pause campaigns with poor
                        performance
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={configForm.autoPauseUnderperformers}
                      onChange={(v) =>
                        updateConfig({
                          autoPauseUnderperformers: v,
                        })
                      }
                      label="Auto-pause underperformers"
                    />
                  </div>

                  <FormField label="CPA Ceiling ($)">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={configForm.cpaCeilingDollars}
                      onChange={(e) =>
                        updateConfig({
                          cpaCeilingDollars: e.target.value,
                        })
                      }
                      placeholder="0.00"
                      className={`${INPUT_CLASS} max-w-[200px]`}
                    />
                  </FormField>
                </div>
              </CollapsibleSection>

              {/* Channel Credentials */}
              <CollapsibleSection
                title="Channel Credentials"
                icon={<Key className="w-4 h-4 text-purple-500" />}
                defaultOpen={false}
              >
                <div className="space-y-4">
                  {CHANNEL_PLATFORMS.map(({ key, label }) => (
                    <div
                      key={key}
                      className="bg-muted/30 rounded-lg border border-border p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-medium text-foreground">
                          {label}
                        </p>
                        <ToggleSwitch
                          checked={
                            configForm.channelCredentials[key]
                              ?.enabled || false
                          }
                          onChange={(v) =>
                            updateChannelCred(key, "enabled", v)
                          }
                          label={`${label} enabled`}
                        />
                      </div>
                      {configForm.channelCredentials[key]
                        ?.enabled && (
                        <FormField label="API Key">
                          <input
                            type="password"
                            value={
                              configForm.channelCredentials[key]
                                ?.apiKey || ""
                            }
                            onChange={(e) =>
                              updateChannelCred(
                                key,
                                "apiKey",
                                e.target.value,
                              )
                            }
                            placeholder="Enter API key (leave blank to keep existing)"
                            className={INPUT_CLASS}
                          />
                        </FormField>
                      )}
                    </div>
                  ))}
                </div>
              </CollapsibleSection>

              {/* Save button */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveConfig}
                  disabled={configSaving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {configSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save Configuration
                </button>
                {configSaved && (
                  <span className="inline-flex items-center gap-1 text-sm text-green-500">
                    <CheckCircle className="w-4 h-4" />
                    Saved
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="bg-card rounded-lg border border-border p-8 text-center">
              <p className="text-muted-foreground">
                Failed to load configuration. Please try again.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
