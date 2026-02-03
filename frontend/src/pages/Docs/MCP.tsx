import {
  Router,
  Terminal,
  Settings,
  Key,
  Copy,
  CheckCircle,
  Play,
  List,
  RefreshCw,
  BarChart3,
  FileText,
  Eye,
} from "lucide-react";
import { useState } from "react";

const mcpConfig = `{
  "mcpServers": {
    "workermill": {
      "type": "sse",
      "url": "https://workermill.com/api/mcp/sse",
      "headers": {
        "x-api-key": "YOUR_API_KEY"
      }
    }
  }
}`;

const toolCategories = [
  {
    title: "Task Management",
    icon: List,
    tools: [
      { name: "workermill_list_tasks", description: "List tasks with optional status filter", params: "status?, limit?, offset?" },
      { name: "workermill_get_task", description: "Get detailed task information", params: "id" },
      { name: "workermill_create_task", description: "Create a new task from Jira issue", params: "jiraIssueKey, persona?, model?" },
      { name: "workermill_cancel_task", description: "Cancel a running task", params: "id" },
      { name: "workermill_retry_task", description: "Retry a failed task", params: "id" },
      { name: "workermill_delete_task", description: "Delete a task from history", params: "id" },
      { name: "workermill_update_task", description: "Update task metadata", params: "taskId, status?, prUrl?, prNumber?" },
    ],
  },
  {
    title: "Plan Management",
    icon: FileText,
    tools: [
      { name: "workermill_get_plan", description: "Get execution plan for PRD task", params: "id" },
      { name: "workermill_approve_plan", description: "Approve an execution plan", params: "id, executionMode?" },
      { name: "workermill_request_changes", description: "Request changes to a plan", params: "id, feedback" },
      { name: "workermill_get_children", description: "Get child tasks of a PRD", params: "id" },
    ],
  },
  {
    title: "Orchestrator Control",
    icon: Play,
    tools: [
      { name: "workermill_orchestrator_status", description: "Get orchestrator status", params: "(none)" },
      { name: "workermill_start_orchestrator", description: "Start task processing", params: "(none)" },
      { name: "workermill_stop_orchestrator", description: "Stop task processing", params: "(none)" },
    ],
  },
  {
    title: "Monitoring",
    icon: BarChart3,
    tools: [
      { name: "workermill_dashboard_stats", description: "Get dashboard statistics", params: "(none)" },
      { name: "workermill_get_task_logs", description: "Get recent task logs", params: "taskId, limit?, since?" },
      { name: "workermill_get_all_task_logs", description: "Get complete task log history", params: "taskId, limit?" },
      { name: "workermill_get_coordination_feed", description: "Get expert collaboration feed", params: "parentTaskId, messageType?, since?, limit?" },
    ],
  },
  {
    title: "Settings & Configuration",
    icon: Settings,
    tools: [
      { name: "workermill_get_settings", description: "Get organization settings", params: "(none)" },
      { name: "workermill_update_settings", description: "Update organization settings", params: "various..." },
      { name: "workermill_get_integrations", description: "Get integration status", params: "(none)" },
      { name: "workermill_get_models", description: "Get available AI models", params: "(none)" },
      { name: "workermill_get_providers", description: "Get AI provider status", params: "(none)" },
    ],
  },
];

const usageExamples = [
  {
    title: "List running tasks",
    description: "Check what tasks are currently executing",
    command: 'workermill_list_tasks(status: "running")',
  },
  {
    title: "Create task from Jira",
    description: "Start a new task from a Jira issue",
    command: 'workermill_create_task(jiraIssueKey: "OCS-123")',
  },
  {
    title: "Check orchestrator",
    description: "See if the orchestrator is running",
    command: "workermill_orchestrator_status()",
  },
  {
    title: "Get task logs",
    description: "View execution logs for a task",
    command: 'workermill_get_task_logs(taskId: "abc-123", limit: 50)',
  },
  {
    title: "View dashboard stats",
    description: "Get overview of task counts and costs",
    command: "workermill_dashboard_stats()",
  },
];

export default function MCP() {
  const [copied, setCopied] = useState(false);

  const copyConfig = () => {
    navigator.clipboard.writeText(mcpConfig);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">MCP Integration</h1>
        <p className="text-muted-foreground">
          Control WorkerMill directly from Claude Code, Claude Desktop, or other MCP-compatible tools
          using the WorkerMill MCP server.
        </p>
      </div>

      {/* What is MCP */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Router className="w-5 h-5 text-primary" />
          What is MCP?
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            <strong className="text-foreground">Model Context Protocol (MCP)</strong> is an open protocol
            that allows AI assistants to connect to external tools and data sources. With the WorkerMill
            MCP server, you can:
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 bg-muted/30 rounded-lg">
              <Terminal className="w-5 h-5 text-primary mb-2" />
              <h4 className="font-medium text-foreground mb-1">Manage Tasks</h4>
              <p className="text-sm text-muted-foreground">Create, monitor, and control tasks from your IDE</p>
            </div>
            <div className="p-4 bg-muted/30 rounded-lg">
              <Eye className="w-5 h-5 text-primary mb-2" />
              <h4 className="font-medium text-foreground mb-1">View Logs</h4>
              <p className="text-sm text-muted-foreground">Stream task logs in real-time</p>
            </div>
            <div className="p-4 bg-muted/30 rounded-lg">
              <Settings className="w-5 h-5 text-primary mb-2" />
              <h4 className="font-medium text-foreground mb-1">Control Platform</h4>
              <p className="text-sm text-muted-foreground">Start/stop orchestrator, update settings</p>
            </div>
          </div>
        </div>
      </section>

      {/* Setup */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Key className="w-5 h-5 text-yellow-500" />
          Setup Guide
        </h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-6">
          {/* Step 1 */}
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">1</div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground mb-2">Generate an API Key</h3>
              <p className="text-sm text-muted-foreground mb-2">
                Go to <strong>WorkerMill Settings → API Access → WorkerMill</strong> and create a new API key.
              </p>
              <p className="text-xs text-muted-foreground">
                Give it a descriptive name like "Claude Code" or "My Laptop".
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">2</div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground mb-2">Add to Claude Code Configuration</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Add this to your <code className="bg-muted px-1.5 py-0.5 rounded">~/.claude/settings.json</code>:
              </p>
              <div className="relative">
                <pre className="text-xs bg-muted/50 p-4 rounded-lg overflow-x-auto border border-border">
                  {mcpConfig}
                </pre>
                <button
                  onClick={copyConfig}
                  className="absolute top-2 right-2 p-2 bg-background/80 rounded hover:bg-background transition-colors"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Replace <code className="bg-muted px-1 rounded">YOUR_API_KEY</code> with the key you generated.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">3</div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground mb-2">Restart Claude Code</h3>
              <p className="text-sm text-muted-foreground">
                Restart Claude Code to load the new MCP server. You should see WorkerMill tools available.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Available Tools */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Available Tools</h2>
        <div className="space-y-4">
          {toolCategories.map((category) => (
            <div key={category.title} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
                <category.icon className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-foreground">{category.title}</h3>
              </div>
              <div className="divide-y divide-border">
                {category.tools.map((tool) => (
                  <div key={tool.name} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <code className="text-sm font-mono text-primary">{tool.name}</code>
                        <p className="text-sm text-muted-foreground mt-0.5">{tool.description}</p>
                      </div>
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded whitespace-nowrap">
                        {tool.params}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Usage Examples */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Terminal className="w-5 h-5 text-green-500" />
          Usage Examples
        </h2>
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-muted-foreground mb-4">
            In Claude Code, you can ask Claude to use these tools naturally:
          </p>
          <div className="space-y-4">
            {usageExamples.map((example) => (
              <div key={example.title} className="p-4 bg-muted/30 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-foreground">{example.title}</h4>
                  <span className="text-xs text-muted-foreground">{example.description}</span>
                </div>
                <code className="text-sm text-green-500 font-mono">{example.command}</code>
              </div>
            ))}
          </div>
          <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <p className="text-sm text-blue-500">
              <strong>Tip:</strong> You can ask Claude naturally like "Show me all running tasks" or
              "Create a task for OCS-456" and it will use the appropriate MCP tools.
            </p>
          </div>
        </div>
      </section>

      {/* Common Workflows */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-primary" />
          Common Workflows
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-3">Monitor Active Work</h3>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Check orchestrator status</li>
              <li>List running tasks</li>
              <li>View logs for specific task</li>
              <li>Check dashboard stats</li>
            </ol>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-3">Create & Track Task</h3>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Create task from Jira issue</li>
              <li>Monitor task status</li>
              <li>View execution logs</li>
              <li>Check coordination feed for epics</li>
            </ol>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-3">Handle Failures</h3>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>List failed tasks</li>
              <li>Get task details and logs</li>
              <li>Retry or cancel task</li>
              <li>Update task metadata if needed</li>
            </ol>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-3">Manage PRD/Epics</h3>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Get execution plan</li>
              <li>Review child tasks</li>
              <li>Approve or request changes</li>
              <li>Monitor coordination feed</li>
            </ol>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Security Notes</h2>
        <div className="bg-card border border-amber-500/30 rounded-xl p-6">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <span>API keys are scoped to your organization</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <span>Keys can be revoked anytime from Settings</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <span>All API calls are logged for audit</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <span>SSE connection encrypted via HTTPS</span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
