import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  CheckCircle,
  Circle,
  GitBranch,
  Ticket,
  Bot,
  Rocket,
  X,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface ChecklistStatus {
  scmConnected: boolean;
  issueTrackerConnected: boolean;
  aiProviderConnected: boolean;
  hasCreatedTask: boolean;
}

export function GettingStartedChecklist() {
  const [status, setStatus] = useState<ChecklistStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(() => {
    // Check localStorage first for instant hide, server-side flag synced on load
    return localStorage.getItem("workermill-onboarding-dismissed") === "true";
  });
  const navigate = useNavigate();
  const location = useLocation();
  const organization = useAuthStore((state) => state.organization);
  const user = useAuthStore((state) => state.user);

  // Sync server-side dismiss flag on mount
  useEffect(() => {
    if ((user as unknown as { onboardingDismissed?: boolean })?.onboardingDismissed) {
      setDismissed(true);
      localStorage.setItem("workermill-onboarding-dismissed", "true");
    }
  }, [user]);

  // Re-fetch status on mount AND when user navigates back (e.g. from settings)
  useEffect(() => {
    if (dismissed) return;
    fetchChecklistStatus();
  }, [dismissed, location.pathname]);

  const fetchChecklistStatus = useCallback(async () => {
    try {
      const token = localStorage.getItem("accessToken");

      const [integrationsResponse, providersResponse, tasksResponse] =
        await Promise.all([
          fetch(`${API_BASE}/api/settings/integrations`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_BASE}/api/settings/providers`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_BASE}/api/control-center`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

      if (!integrationsResponse.ok || !providersResponse.ok) {
        throw new Error("Failed to fetch status");
      }

      const integrations = await integrationsResponse.json();
      const providersData = await providersResponse.json();

      // SCM check
      const githubConfigured = integrations.github?.configured || false;
      const bitbucketConfigured = integrations.bitbucket?.configured || false;
      const gitlabConfigured = integrations.gitlab?.configured || false;
      const scmConnected =
        githubConfigured || bitbucketConfigured || gitlabConfigured;

      // Issue tracker check
      const jiraConfigured = integrations.jira?.configured || false;
      const linearConfigured = integrations.linear?.configured || false;
      const issueTrackerConnected = jiraConfigured || linearConfigured;

      // AI provider check
      const providers = providersData.providers || [];
      const aiProviderConnected = providers.some(
        (p: { id: string; configured: boolean }) =>
          p.configured &&
          [
            "anthropic",
            "openai",
            "google",
            "openrouter",
            "groq",
            "deepseek",
            "mistral",
            "xai",
          ].includes(p.id),
      );

      // Task creation check — has user ever created a task?
      let hasCreatedTask = false;
      if (tasksResponse.ok) {
        const tasksData = await tasksResponse.json();
        const activeTasks = tasksData.activeTasks || [];
        const completedTasks = tasksData.completedTasks || [];
        hasCreatedTask =
          activeTasks.length > 0 || completedTasks.length > 0;
      }

      setStatus({
        scmConnected,
        issueTrackerConnected,
        aiProviderConnected,
        hasCreatedTask,
      });
    } catch {
      // Silently fail — checklist won't show
    } finally {
      setLoading(false);
    }
  }, [dismissed]);

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem("workermill-onboarding-dismissed", "true");
    // Persist server-side so it stays dismissed across browsers/devices
    const token = localStorage.getItem("accessToken");
    fetch(`${API_BASE}/api/auth/dismiss-onboarding`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {}); // Best effort
  };

  if (dismissed || loading || !status) return null;

  // Count completed steps
  const steps = [
    status.scmConnected,
    status.issueTrackerConnected,
    status.aiProviderConnected,
    status.hasCreatedTask,
  ];
  const totalSteps = steps.length;
  const completedCount = steps.filter(Boolean).length;

  // Hide when all steps are completed
  if (completedCount >= totalSteps) return null;

  const progressPercent = (completedCount / totalSteps) * 100;

  return (
    <div className="border border-border/50 rounded-xl bg-card p-5 mb-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-4.5 h-4.5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">
              Getting Started
            </h3>
            <p className="text-xs text-muted-foreground">
              {completedCount} of {totalSteps} steps completed
            </p>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 -m-1"
          aria-label="Dismiss checklist"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="mb-5">
        <div className="h-1.5 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500 rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-1">
        <ChecklistStep
          completed={status.scmConnected}
          stepNumber={1}
          title="Connect your code repository"
          description="GitHub, GitLab, or Bitbucket"
          icon={GitBranch}
          onClick={() => navigate("/settings?tab=integrations")}
          actionLabel="Connect"
        />
        <ChecklistStep
          completed={status.issueTrackerConnected}
          stepNumber={2}
          title="Connect your project tracker"
          description="Jira, Linear, or use the built-in board"
          icon={Ticket}
          onClick={() => navigate("/settings?tab=integrations")}
          actionLabel="Connect"
          optional
        />
        <ChecklistStep
          completed={status.aiProviderConnected}
          stepNumber={3}
          title="Set up your AI provider API key"
          description="Anthropic, OpenAI, Google, or others"
          icon={Bot}
          onClick={() => navigate("/settings?tab=ai-workers")}
          actionLabel="Configure"
        />
        <ChecklistStep
          completed={status.hasCreatedTask}
          stepNumber={4}
          title="Create your first task"
          description="Run a task from the dashboard or a board"
          icon={Rocket}
          onClick={() => navigate("/boards")}
          actionLabel="Go to Boards"
        />
      </div>
    </div>
  );
}

interface ChecklistStepProps {
  completed: boolean;
  stepNumber: number;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  actionLabel: string;
  optional?: boolean;
}

function ChecklistStep({
  completed,
  stepNumber: _stepNumber,
  title,
  description,
  icon: Icon,
  onClick,
  actionLabel,
  optional,
}: ChecklistStepProps) {
  return (
    <div
      className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
        completed
          ? "opacity-60"
          : "hover:bg-muted/50 cursor-pointer"
      }`}
      onClick={completed ? undefined : onClick}
      role={completed ? undefined : "button"}
      tabIndex={completed ? undefined : 0}
      onKeyDown={
        completed
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
      }
    >
      {/* Check icon */}
      <div className="flex-shrink-0">
        {completed ? (
          <CheckCircle className="w-5 h-5 text-green-500" />
        ) : (
          <Circle className="w-5 h-5 text-muted-foreground/40" />
        )}
      </div>

      {/* Icon */}
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          completed ? "bg-green-500/10" : "bg-muted"
        }`}
      >
        <Icon
          className={`w-4 h-4 ${completed ? "text-green-500" : "text-muted-foreground"}`}
        />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-medium ${
              completed
                ? "text-muted-foreground line-through"
                : "text-foreground"
            }`}
          >
            {title}
          </span>
          {optional && (
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">
              Optional
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{description}</p>
      </div>

      {/* Action */}
      {!completed && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium flex-shrink-0 transition-colors"
        >
          {actionLabel}
          <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
