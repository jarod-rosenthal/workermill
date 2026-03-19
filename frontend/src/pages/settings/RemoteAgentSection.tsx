import { useState } from "react";
import {
  CheckCircle,
  ExternalLink,
  Loader2,
  Server,
  Copy,
  Zap,
  Brain,
  Key,
  RefreshCw,
  Eye,
  EyeOff,
  Trash2,
  Monitor,
  WifiOff,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface RemoteAgent {
  agentId: string;
  status: string;
  activeTasks: number;
  maxWorkers: number;
  hostname: string | null;
  platform: string | null;
  nodeVersion: string | null;
  apiKeyPrefix: string | null;
  lastHeartbeatAt: string;
}

interface RemoteAgentSectionProps {
  remoteAgents: RemoteAgent[];
  remoteAgentsLoading: boolean;
  orgPlan?: string;
  apiKeyPrefix?: string | null;
  onAgentRemoved?: () => void;
  remoteAgentOnly?: boolean;
  onToggleRemoteAgentOnly?: (enabled: boolean) => void;
}

function ApiKeySection({ apiKeyPrefix }: { apiKeyPrefix?: string | null }) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const generateKey = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(
        `${API_BASE}/api/organizations/current/rotate-api-key`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) {
        throw new Error("Failed to generate API key");
      }

      const data = await response.json();
      setApiKey(data.apiKey);
      setRevealed(true);
    } catch {
      // error handled silently
    } finally {
      setLoading(false);
    }
  };

  const copyKey = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-primary/30 rounded-xl p-6 bg-primary/5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
          <Key className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">API Key</h3>
          <p className="text-sm text-muted-foreground">
            Required for the VS Code extension and CLI agent
          </p>
        </div>
      </div>

      {apiKey ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 bg-background/80 rounded-lg px-4 py-3 font-mono text-sm border border-border/50">
            <code className="text-foreground flex-1 select-all">
              {revealed ? apiKey : apiKey.substring(0, 12) + "..." + "x".repeat(20)}
            </code>
            <button
              onClick={() => setRevealed(!revealed)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title={revealed ? "Hide" : "Reveal"}
            >
              {revealed ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={copyKey}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Copy to clipboard"
            >
              {copied ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="text-xs text-amber-400">
            Save this key now — it won't be shown again. If you lose it, generate a new one.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {apiKeyPrefix && (
            <p className="text-sm text-muted-foreground">
              Current key: <code className="text-foreground">{apiKeyPrefix}...</code>
            </p>
          )}
          <button
            onClick={generateKey}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {apiKeyPrefix ? "Generate New API Key" : "Generate API Key"}
          </button>
          {apiKeyPrefix && (
            <p className="text-xs text-muted-foreground">
              This will invalidate the current key. Any connected agents will need to be reconfigured.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function InstallInstructions() {
  const [platform, setPlatform] = useState<"unix" | "windows">("unix");

  const commands = {
    unix: [
      { step: "1", label: "Install", cmd: "curl -fsSL https://workermill.com/install.sh | bash" },
      { step: "2", label: "Setup", cmd: "workermill-agent setup" },
      { step: "3", label: "Start", cmd: "workermill-agent start" },
    ],
    windows: [
      { step: "1", label: "Install", cmd: "irm https://workermill.com/install.ps1 | iex" },
      { step: "2", label: "Setup", cmd: "workermill-agent setup" },
      { step: "3", label: "Start", cmd: "workermill-agent start" },
    ],
  };

  return (
    <div className="border border-border/50 rounded-xl p-6 bg-card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
            <Server className="w-5 h-5 text-cyan-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Install the Remote Agent</h3>
            <p className="text-sm text-muted-foreground">Three commands to get running</p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
          <button
            onClick={() => setPlatform("unix")}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${platform === "unix" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Mac / Linux
          </button>
          <button
            onClick={() => setPlatform("windows")}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${platform === "windows" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            Windows
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {commands[platform].map((item) => (
          <div key={item.step} className="flex items-center gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-500 text-xs font-bold flex items-center justify-center">
              {item.step}
            </span>
            <div className="flex-1 flex items-center gap-2 bg-muted/30 rounded-lg px-4 py-2.5 font-mono text-sm">
              <span className="text-muted-foreground">{item.label}:</span>
              <code className="text-foreground flex-1 break-all">{item.cmd}</code>
              <button
                onClick={() => navigator.clipboard.writeText(item.cmd)}
                className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                title="Copy to clipboard"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Or install the{" "}
          <a href="https://marketplace.visualstudio.com/items?itemName=workermill.workermill" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            VS Code extension
          </a>
          {" "}&mdash; it handles install, setup, and agent startup automatically.
        </p>
        <a
          href="https://workermill.com/docs/quick-start"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-primary hover:underline flex-shrink-0"
        >
          <ExternalLink className="w-3 h-3" />
          Full install guide
        </a>
      </div>
    </div>
  );
}

export function RemoteAgentSection({
  remoteAgents,
  remoteAgentsLoading,
  orgPlan: _orgPlan,
  apiKeyPrefix,
  onAgentRemoved,
  remoteAgentOnly,
  onToggleRemoteAgentOnly,
}: RemoteAgentSectionProps) {
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [disconnectingAgentId, setDisconnectingAgentId] = useState<string | null>(null);

  const handleRemoveAgent = async (agentId: string) => {
    if (!confirm(`Remove agent "${agentId}"? This will unregister it from your organization.`)) return;
    setDeletingAgentId(agentId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/settings/remote-agents/${encodeURIComponent(agentId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        onAgentRemoved?.();
      } else {
        const data = await response.json();
        alert(data.error || "Failed to remove agent");
      }
    } catch {
      alert("Failed to remove agent");
    } finally {
      setDeletingAgentId(null);
    }
  };

  const handleDisconnectAgent = async (agentId: string) => {
    if (!confirm(`Force-disconnect agent "${agentId}"? The agent will need to reconnect.`)) return;
    setDisconnectingAgentId(agentId);
    try {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${API_BASE}/api/settings/remote-agents/${encodeURIComponent(agentId)}/disconnect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        onAgentRemoved?.();
      } else {
        const data = await response.json();
        alert(data.error || "Failed to disconnect agent");
      }
    } catch {
      alert("Failed to disconnect agent");
    } finally {
      setDisconnectingAgentId(null);
    }
  };
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">Remote Agent</h2>
        <p className="text-sm text-muted-foreground">Run AI workers on your own machine with your Anthropic API key</p>
      </div>

      {/* Local Mode Toggle */}
      <div className="border border-border/50 rounded-xl p-6 bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <Monitor className="w-5 h-5 text-cyan-500" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Local Mode</h3>
              <p className="text-sm text-muted-foreground">Route all tasks to your remote agent instead of cloud workers</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={remoteAgentOnly ?? false}
              onChange={(e) => onToggleRemoteAgentOnly?.(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </div>
      </div>

      {/* API Key — first thing users need */}
      <ApiKeySection apiKeyPrefix={apiKeyPrefix} />

      {/* Install Instructions */}
      <InstallInstructions />

      {/* Prerequisites */}
      <div className="border border-border/50 rounded-xl p-6 bg-card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <CheckCircle className="w-5 h-5 text-purple-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Prerequisites</h3>
            <p className="text-sm text-muted-foreground">Required on the machine running the agent</p>
          </div>
        </div>
        <div className="space-y-2">
          {[
            { name: "Claude CLI", detail: "Installed automatically by the VS Code extension or install.sh" },
            { name: "Anthropic API key", detail: "Or existing Claude CLI authentication" },
            { name: "SCM token", detail: "Configure in Settings > Integrations" },
          ].map((item) => (
            <div key={item.name} className="flex items-start gap-3 py-1.5">
              <CheckCircle className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-sm font-medium text-foreground">{item.name}</span>
                <span className="text-sm text-muted-foreground ml-2">{item.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Connected Agents */}
      <div className="border border-border/50 rounded-xl p-6 bg-card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <Zap className="w-5 h-5 text-green-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Connected Agents</h3>
            <p className="text-sm text-muted-foreground">Agents registered with your organization</p>
          </div>
        </div>

        {remoteAgentsLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading agents...</span>
          </div>
        ) : remoteAgents.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">
            No agents connected. Install and run the agent to see it here.
          </div>
        ) : (
          <div className="space-y-3">
            {remoteAgents.map((agent) => (
              <div key={agent.agentId} className="border border-border/30 rounded-lg p-4 bg-muted/10">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${agent.status === "online" ? "bg-green-500" : "bg-red-500"}`} />
                    <span className="font-medium text-foreground text-sm">{agent.agentId}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${agent.status === "online" ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
                      {agent.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {agent.activeTasks}/{agent.maxWorkers} workers
                    </span>
                    {agent.status === "online" && (
                      <button
                        onClick={() => handleDisconnectAgent(agent.agentId)}
                        disabled={disconnectingAgentId === agent.agentId}
                        className="text-muted-foreground hover:text-amber-500 transition-colors disabled:opacity-50"
                        title="Force disconnect"
                      >
                        {disconnectingAgentId === agent.agentId ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <WifiOff className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => handleRemoveAgent(agent.agentId)}
                      disabled={deletingAgentId === agent.agentId}
                      className="text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                      title="Remove agent"
                    >
                      {deletingAgentId === agent.agentId ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {agent.hostname && <span>Host: {agent.hostname}</span>}
                  {agent.platform && <span>Platform: {agent.platform}</span>}
                  {agent.nodeVersion && <span>Node: {agent.nodeVersion}</span>}
                  {agent.apiKeyPrefix && (
                    <span>Key: <code className="text-foreground">{agent.apiKeyPrefix}...</code></span>
                  )}
                  <span>Last seen: {new Date(agent.lastHeartbeatAt).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="border border-border/50 rounded-xl p-6 bg-card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Brain className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">How It Works</h3>
            <p className="text-sm text-muted-foreground">Architecture overview</p>
          </div>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>The remote agent runs on your machine and connects to the WorkerMill cloud dashboard:</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>Agent polls the cloud API for tasks assigned to your organization</li>
            <li>Planning runs locally via Claude CLI using your Anthropic API key</li>
            <li>Worker containers spawn locally via Docker, executing code changes</li>
            <li>Logs and status stream back to the cloud dashboard in real-time</li>
            <li>PRs are created on your SCM provider (GitHub/GitLab/Bitbucket)</li>
          </ol>
          <p className="mt-3">
            <span className="font-medium text-foreground">Cost:</span> BYOK — you pay your AI provider directly at their rates.
          </p>
        </div>
      </div>
    </div>
  );
}
