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
  budget_reallocated: "bg-orange-500/10 text-orange-500 border-orange-500/20",
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

// --- Component ---

type SubTab = "campaigns" | "content" | "actions" | "config";

export function MarketingTab({ accessToken }: { accessToken: string }) {
  const [subTab, setSubTab] = useState<SubTab>("campaigns");
  const [stats, setStats] = useState<MarketingStats | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: `Bearer ${accessToken}` };

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
          </div>
          {campaigns.length === 0 ? (
            <div className="p-8 text-center">
              <Megaphone className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">No campaigns yet</p>
            </div>
          ) : (
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
                      <td className="px-4 py-3">{statusBadge(c.status)}</td>
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
          )}
        </div>
      )}

      {subTab === "content" && (
        <div className="space-y-6">
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
        <div className="bg-card rounded-lg border border-border p-8 text-center">
          <p className="text-muted-foreground">
            Marketing agent configuration panel — coming in next iteration.
          </p>
        </div>
      )}
    </div>
  );
}
