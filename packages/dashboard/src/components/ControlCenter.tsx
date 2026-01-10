import { useState } from "react";
import {
  useControlCenter,
  type ActiveTask,
  type CompletedTask,
} from "../hooks/useControlCenter";

// Persona configuration
const PERSONA_CONFIG: Record<
  string,
  { emoji: string; title: string; color: string }
> = {
  frontend_developer: {
    emoji: "🎨",
    title: "Frontend",
    color: "bg-purple-500",
  },
  backend_developer: { emoji: "⚙️", title: "Backend", color: "bg-blue-500" },
  devops_engineer: { emoji: "🔧", title: "DevOps", color: "bg-orange-500" },
  security_engineer: { emoji: "🔒", title: "Security", color: "bg-red-500" },
  qa_engineer: { emoji: "🧪", title: "QA", color: "bg-green-500" },
  tech_writer: { emoji: "📝", title: "Tech Writer", color: "bg-yellow-500" },
  project_manager: { emoji: "📋", title: "PM", color: "bg-indigo-500" },
};

// Status color mapping
const STATUS_COLORS: Record<string, string> = {
  queued: "bg-gray-500",
  dispatching: "bg-yellow-500",
  claimed: "bg-blue-400",
  environment_setup: "bg-blue-500",
  executing: "bg-green-500",
  pr_created: "bg-purple-500",
  review_pending: "bg-yellow-500",
  manager_review: "bg-yellow-600",
  revision_needed: "bg-orange-500",
  review_approved: "bg-green-500",
  review_rejected: "bg-red-500",
  completed: "bg-green-600",
  failed: "bg-red-600",
  cancelled: "bg-gray-600",
};

function formatCost(cost: number | undefined | null): string {
  if (cost === undefined || cost === null) return "0.00";
  return cost.toFixed(2);
}

function formatModel(model: string | undefined | null): string {
  if (!model) return "Sonnet";
  const lower = model.toLowerCase();
  if (lower.includes("opus")) return "Opus";
  if (lower.includes("haiku")) return "Haiku";
  if (lower.includes("sonnet")) return "Sonnet";
  return model;
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "-";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatTime(dateString: string | null): string {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Stats Card Component
function StatsCard({
  title,
  value,
  subtitle,
  icon,
  color = "text-white",
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-400 text-sm">{title}</p>
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
          {subtitle && <p className="text-gray-500 text-xs">{subtitle}</p>}
        </div>
        {icon && <div className="text-gray-500 text-2xl">{icon}</div>}
      </div>
    </div>
  );
}

// Task Progress Component
function TaskProgress({ steps }: { steps: { current: number; total: number; label: string } }) {
  const progress = (steps.current / steps.total) * 100;
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>{steps.label}</span>
        <span>
          {steps.current}/{steps.total}
        </span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-green-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

// Active Task Card Component
function ActiveTaskCard({ task }: { task: ActiveTask }) {
  const personaConfig = PERSONA_CONFIG[task.workerPersona] || {
    emoji: "🤖",
    title: task.workerPersona,
    color: "bg-gray-500",
  };
  const statusColor = STATUS_COLORS[task.status] || "bg-gray-500";

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{personaConfig.emoji}</span>
          <div>
            <span className="text-white font-medium">{task.externalKey}</span>
            <span className="text-gray-400 text-sm ml-2">
              {task.workerName}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded text-xs text-white ${statusColor}`}
          >
            {task.status.replace(/_/g, " ")}
          </span>
          {task.workerModel && (
            <span className="px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-300">
              {formatModel(task.workerModel)}
            </span>
          )}
        </div>
      </div>

      <p className="text-gray-300 text-sm mb-3 line-clamp-2">{task.summary}</p>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-4 text-gray-400">
          <span>${formatCost(task.estimatedCostUsd)}</span>
          {task.startedAt && <span>Started {formatTime(task.startedAt)}</span>}
        </div>
        {task.hasPr && task.gitPrUrl && (
          <a
            href={task.gitPrUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 text-sm"
          >
            View PR →
          </a>
        )}
      </div>

      <TaskProgress steps={task.steps} />
    </div>
  );
}

// Completed Task Row Component
function CompletedTaskRow({ task }: { task: CompletedTask }) {
  const isSuccess = task.status === "completed" || task.status === "review_approved";

  return (
    <tr className="border-b border-gray-700 hover:bg-gray-800/50">
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <span className={isSuccess ? "text-green-500" : "text-red-500"}>
            {isSuccess ? "✓" : "✕"}
          </span>
          <span className="text-white">{task.externalKey}</span>
        </div>
      </td>
      <td className="py-3 px-4 text-gray-300 max-w-xs truncate">
        {task.summary}
      </td>
      <td className="py-3 px-4">
        <span
          className={`px-2 py-0.5 rounded text-xs text-white ${
            STATUS_COLORS[task.status] || "bg-gray-500"
          }`}
        >
          {task.status}
        </span>
      </td>
      <td className="py-3 px-4 text-gray-400">
        {formatModel(task.workerModel)}
      </td>
      <td className="py-3 px-4 text-gray-400">
        ${formatCost(task.costUsd)}
      </td>
      <td className="py-3 px-4 text-gray-400">
        {formatDuration(task.durationMinutes)}
      </td>
      <td className="py-3 px-4">
        {task.gitPrUrl ? (
          <a
            href={task.gitPrUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300"
          >
            PR
          </a>
        ) : (
          <span className="text-gray-500">-</span>
        )}
      </td>
    </tr>
  );
}

// Main Control Center Component
export default function ControlCenter() {
  const [apiKey] = useState(() => {
    // Try to get API key from URL params or localStorage
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("apiKey") || localStorage.getItem("workermill_api_key") || "";
  });

  const { data, loading, error, lastUpdated, connected, refresh } = useControlCenter({
    apiUrl: import.meta.env.VITE_API_URL || "",
    apiKey,
    useSSE: true,
  });

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading Control Center...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-4">Error: {error}</div>
          <button
            onClick={refresh}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const stats = data?.stats;
  const activeTasks = data?.activeTasks || [];
  const recentCompleted = data?.recentCompleted || [];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold">WorkerMill Control Center</h1>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  connected ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className="text-gray-400 text-sm">
                {connected ? "Live" : "Disconnected"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {lastUpdated && (
              <span className="text-gray-400 text-sm">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={refresh}
              className="px-3 py-1.5 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="p-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
          <StatsCard
            title="Queue Depth"
            value={stats?.queueDepth || 0}
            color={stats?.queueDepth ? "text-yellow-400" : "text-white"}
          />
          <StatsCard
            title="Active Workers"
            value={`${stats?.activeWorkers || 0}/${stats?.totalWorkers || 0}`}
          />
          <StatsCard
            title="Today Completed"
            value={stats?.todayCompleted || 0}
            color="text-green-400"
          />
          <StatsCard
            title="Today Failed"
            value={stats?.todayFailed || 0}
            color={stats?.todayFailed ? "text-red-400" : "text-white"}
          />
          <StatsCard
            title="Today Cost"
            value={`$${formatCost(stats?.todayCost)}`}
          />
          <StatsCard
            title="Cumulative Cost"
            value={`$${formatCost(stats?.cumulativeCost)}`}
            color="text-blue-400"
          />
        </div>

        {/* Active Tasks */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Active Tasks ({activeTasks.length})
          </h2>
          {activeTasks.length === 0 ? (
            <div className="bg-gray-800 rounded-lg p-8 text-center border border-gray-700">
              <p className="text-gray-400">No active tasks</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeTasks.map((task) => (
                <ActiveTaskCard key={task.id} task={task} />
              ))}
            </div>
          )}
        </section>

        {/* Recent Completed */}
        <section>
          <h2 className="text-lg font-semibold mb-4">
            Recent Completed ({recentCompleted.length})
          </h2>
          {recentCompleted.length === 0 ? (
            <div className="bg-gray-800 rounded-lg p-8 text-center border border-gray-700">
              <p className="text-gray-400">No completed tasks today</p>
            </div>
          ) : (
            <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-750 border-b border-gray-700">
                  <tr className="text-left text-gray-400 text-sm">
                    <th className="py-3 px-4">Task</th>
                    <th className="py-3 px-4">Summary</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Model</th>
                    <th className="py-3 px-4">Cost</th>
                    <th className="py-3 px-4">Duration</th>
                    <th className="py-3 px-4">PR</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCompleted.map((task) => (
                    <CompletedTaskRow key={task.id} task={task} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
