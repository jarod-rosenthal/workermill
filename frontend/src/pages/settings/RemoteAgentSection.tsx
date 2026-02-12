import {
  CheckCircle,
  Loader2,
  Server,
  Copy,
  Zap,
  Brain,
} from "lucide-react";

interface RemoteAgent {
  agentId: string;
  status: string;
  activeTasks: number;
  maxWorkers: number;
  hostname: string | null;
  platform: string | null;
  nodeVersion: string | null;
  lastHeartbeatAt: string;
}

interface RemoteAgentSectionProps {
  remoteAgents: RemoteAgent[];
  remoteAgentsLoading: boolean;
}

export function RemoteAgentSection({
  remoteAgents,
  remoteAgentsLoading,
}: RemoteAgentSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-1">Remote Agent</h2>
        <p className="text-sm text-muted-foreground">Run AI workers on your own machine with your Claude Max subscription</p>
      </div>

      {/* Install Instructions */}
      <div className="border border-border/50 rounded-xl p-6 bg-card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
            <Server className="w-5 h-5 text-cyan-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Quick Start</h3>
            <p className="text-sm text-muted-foreground">Three commands to get running</p>
          </div>
        </div>
        <div className="space-y-3">
          {[
            { step: "1", label: "Install", cmd: "npm install -g @workermill/agent" },
            { step: "2", label: "Setup", cmd: "workermill-agent setup" },
            { step: "3", label: "Start", cmd: "workermill-agent start" },
          ].map((item) => (
            <div key={item.step} className="flex items-center gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-500 text-xs font-bold flex items-center justify-center">
                {item.step}
              </span>
              <div className="flex-1 flex items-center gap-2 bg-muted/30 rounded-lg px-4 py-2.5 font-mono text-sm">
                <span className="text-muted-foreground">{item.label}:</span>
                <code className="text-foreground flex-1">{item.cmd}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(item.cmd)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy to clipboard"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          The setup wizard will prompt for your API key (available in Integrations &gt; API Keys) and validate all prerequisites.
        </p>
      </div>

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
            { name: "Docker", detail: "Container runtime for worker isolation" },
            { name: "Claude CLI", detail: "npm install -g @anthropic-ai/claude-code" },
            { name: "Claude Max subscription", detail: "Authenticated via 'claude auth login'" },
            { name: "Node.js >= 20", detail: "Runtime for the agent process" },
            { name: "SCM token", detail: "GitHub, GitLab, or Bitbucket access token for cloning repos" },
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
                  <span className="text-xs text-muted-foreground">
                    {agent.activeTasks}/{agent.maxWorkers} workers
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {agent.hostname && <span>Host: {agent.hostname}</span>}
                  {agent.platform && <span>Platform: {agent.platform}</span>}
                  {agent.nodeVersion && <span>Node: {agent.nodeVersion}</span>}
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
            <li>Planning runs locally via Claude CLI (using your Claude Max subscription)</li>
            <li>Worker containers spawn locally via Docker, executing code changes</li>
            <li>Logs and status stream back to the cloud dashboard in real-time</li>
            <li>PRs are created on your SCM provider (GitHub/GitLab/Bitbucket)</li>
          </ol>
          <p className="mt-3">
            <span className="font-medium text-foreground">Cost:</span> Only your Claude Max subscription. No per-token API charges.
          </p>
        </div>
      </div>
    </div>
  );
}
