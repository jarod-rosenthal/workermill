import {
  Rocket,
  ArrowRight,
  Copy,
  ExternalLink,
  Cloud,
  Terminal,
  Check,
  Settings,
  GitBranch,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";

function CopyBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      {label && (
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
      )}
      <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm flex items-center justify-between">
        <code className="text-foreground">{code}</code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="text-muted-foreground hover:text-foreground flex-shrink-0 ml-4"
        >
          {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

export default function QuickStart() {
  return (
    <div className="space-y-12">
      {/* Hero */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 text-green-500 text-sm font-medium mb-4">
          <Rocket className="w-4 h-4" />
          Quick Start Guide
        </div>
        <h1 className="text-4xl font-bold text-foreground">
          Get Started in 2 Minutes
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Run WorkerMill locally with any LLM provider. No account needed.
        </p>
      </div>

      {/* Option Selector */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Option A: CLI */}
        <div className="bg-card border-2 border-primary/50 rounded-xl p-6 relative">
          <div className="absolute -top-3 left-4">
            <span className="px-3 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-full">
              Recommended
            </span>
          </div>
          <div className="flex items-center gap-3 mb-4 mt-1">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">WorkerMill CLI</h2>
              <p className="text-sm text-green-500 font-medium">Open source — runs locally</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Multi-expert AI coding agent in your terminal. Works with Ollama, Anthropic, OpenAI, and Google.
          </p>
          <div className="text-sm text-muted-foreground">
            <strong className="text-foreground">Requires:</strong> Node.js 20+ and an LLM provider (Ollama for free local, or a cloud API key)
          </div>
        </div>

        {/* Option B: Cloud Platform */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <Cloud className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Cloud Platform</h2>
              <p className="text-sm text-purple-500 font-medium">Dashboard + VS Code extension</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Web dashboard, issue tracker webhooks, and remote agent with Docker sandbox workers.
          </p>
          <div className="text-sm text-muted-foreground">
            <strong className="text-foreground">Requires:</strong> Account + AI provider API key
          </div>
        </div>
      </div>

      {/* CLI Steps */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-green-500" />
          <h2 className="text-2xl font-semibold text-foreground">WorkerMill CLI</h2>
        </div>

        <div className="space-y-4">
          {/* Step 1 */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                1
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground text-lg">Run the CLI</h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">30 sec</span>
                </div>
                <p className="text-muted-foreground mb-4">No install required — npx runs it directly.</p>
                <CopyBlock code="npx workermill" />
                <p className="text-xs text-muted-foreground mt-2">
                  Or install globally: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">npm install -g workermill</code>
                </p>
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                2
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground text-lg">Pick your provider</h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">1 min</span>
                </div>
                <p className="text-muted-foreground mb-4">First run walks you through an interactive setup wizard.</p>
                <div className="grid md:grid-cols-2 gap-3">
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="font-medium text-foreground text-sm mb-1">Ollama (local, free)</div>
                    <p className="text-xs text-muted-foreground">Auto-detected on localhost. WSL supported. Default model: qwen3-coder:30b</p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="font-medium text-foreground text-sm mb-1">Anthropic (Claude)</div>
                    <p className="text-xs text-muted-foreground">Default model: claude-sonnet-4-6. Set ANTHROPIC_API_KEY or paste during setup.</p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="font-medium text-foreground text-sm mb-1">OpenAI (GPT)</div>
                    <p className="text-xs text-muted-foreground">Default model: gpt-5.4. Set OPENAI_API_KEY or paste during setup.</p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="font-medium text-foreground text-sm mb-1">Google (Gemini)</div>
                    <p className="text-xs text-muted-foreground">Default model: gemini-3.1-pro. Set GOOGLE_API_KEY or paste during setup.</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Config saved to <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">~/.workermill/cli.json</code>. Edit anytime or re-run setup.
                </p>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                3
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground text-lg">Describe what you want</h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">That's it</span>
                </div>
                <p className="text-muted-foreground mb-4">
                  Type your task or use <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">/ship spec.md</code> for multi-expert mode. The planner reads your codebase, understands your patterns, then briefs each specialist with exactly which files to follow and how to integrate.
                </p>
                <div className="bg-muted/30 rounded-lg p-4 font-mono text-xs text-muted-foreground space-y-1">
                  <div className="text-white">  WorkerMill <span className="text-muted-foreground">v0.15.31</span></div>
                  <div>  ollama/<span className="text-white">qwen3-coder:30b</span></div>
                  <div>  cwd: <span className="text-white">~/projects/myapp</span></div>
                  <div />
                  <div className="text-white">  &gt; /ship add-webhooks.md</div>
                  <div />
                  <div className="text-cyan-400">  [💡 planner] Analyzing codebase: FastAPI, Pydantic, Alembic...</div>
                  <div className="text-cyan-400">  [💡 planner] Story 1: [backend_developer] Webhook system</div>
                  <div className="text-cyan-400">  [💡 planner]   patterns: src/models/product.py, src/routers/products.py</div>
                  <div className="text-cyan-400">  [💡 planner]   guidance: Follow product.py model pattern with...</div>
                  <div className="text-cyan-400">  [💻 backend_developer] Starting: Webhook system</div>
                  <div className="text-cyan-400">  [💻 backend_developer] Tool: read_file → src/models/product.py</div>
                  <div className="text-cyan-400">  [💻 backend_developer] Tool: write_file → src/models/webhook.py</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CLI Options */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">CLI Options</h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-foreground">Flag</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-foreground">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                { flag: "--trust", desc: "Skip tool permission prompts (auto-approve all)" },
                { flag: "--plan", desc: "Read-only mode — explore the codebase without making changes" },
                { flag: "--resume", desc: "Resume the last conversation" },
                { flag: "--provider <name>", desc: "Override provider (ollama, anthropic, openai, google)" },
                { flag: "--model <name>", desc: "Override model for this session" },
                { flag: "--full-disk", desc: "Allow tools to access files outside working directory" },
              ].map((row) => (
                <tr key={row.flag}>
                  <td className="px-4 py-3">
                    <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono text-foreground">{row.flag}</code>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Slash Commands */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Slash Commands</h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-foreground">Command</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-foreground">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                { cmd: "/help", desc: "Show all available commands" },
                { cmd: "/status", desc: "Session stats — messages, tokens, cost, mode" },
                { cmd: "/cost", desc: "Token cost breakdown by provider" },
                { cmd: "/model", desc: "Show current provider and model" },
                { cmd: "/git", desc: "Show branch and working tree status" },
                { cmd: "/plan", desc: "Toggle read-only plan mode" },
                { cmd: "/sessions", desc: "List, switch, or delete sessions" },
                { cmd: "/compact", desc: "Compress conversation to save context" },
                { cmd: "/editor", desc: "Open $EDITOR for multiline input" },
                { cmd: "!<cmd>", desc: "Run a bash command directly (e.g. !git status)" },
              ].map((row) => (
                <tr key={row.cmd}>
                  <td className="px-4 py-3">
                    <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono text-foreground">{row.cmd}</code>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Cloud Platform Steps */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <Cloud className="w-5 h-5 text-purple-500" />
          <h2 className="text-2xl font-semibold text-foreground">Cloud Platform</h2>
        </div>

        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                1
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground text-lg mb-1">Sign up & configure</h3>
                <p className="text-muted-foreground">
                  Create an account at <Link to="/signup" className="text-primary hover:underline">workermill.com/signup</Link>,
                  then add your AI provider API key in <strong className="text-foreground">Settings &gt; AI Providers</strong> and
                  connect your GitHub, GitLab, or Bitbucket repositories.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                2
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground text-lg mb-1">Start a build</h3>
                <p className="text-muted-foreground mb-3">
                  Two ways to start: <strong className="text-foreground">Full Build</strong> (paste or upload a spec, it decomposes into a board of cards) or <strong className="text-foreground">Run Task</strong> (single task from the dashboard). You can also add the <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">workermill</code> label to an issue in Jira, Linear, or GitHub Issues.
                </p>
                <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                  <li>Spec validation checks for dependency conflicts and quality issues</li>
                  <li>The Planning Agent decomposes your spec into stories</li>
                  <li>Parallel workers execute stories in Docker sandboxes</li>
                  <li>Tech Lead reviews the work and creates a pull request</li>
                  <li>You review and merge</li>
                </ol>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                3
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground text-lg mb-1">Optional: Install the VS Code extension</h3>
                <p className="text-muted-foreground">
                  See worker logs, coordination feed, and live diffs directly in your editor.
                </p>
                <a
                  href="https://marketplace.visualstudio.com/items?itemName=workermill.workermill"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-primary hover:underline mt-2"
                >
                  <ExternalLink className="w-3 h-3" />
                  VS Code Marketplace
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Webhook Integration */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Issue Tracker Webhooks</h2>
        <p className="text-muted-foreground">
          For the cloud platform, trigger builds from your issue tracker by adding the <code className="bg-muted px-1.5 py-0.5 rounded">workermill</code> label.
        </p>
        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4">
            <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Jira
            </h4>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Go to <strong>Project Settings &gt; Webhooks</strong></li>
              <li>Add webhook URL: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">https://workermill.com/api/webhooks/jira</code></li>
              <li>Set JQL filter: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">labels = workermill</code></li>
            </ol>
          </div>
          <div className="bg-muted/50 rounded-lg p-4">
            <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Linear
            </h4>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Go to <strong>Settings &gt; API &gt; Webhooks</strong></li>
              <li>Add webhook URL: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">https://workermill.com/api/webhooks/linear</code></li>
              <li>Select events: Issue created, Issue updated</li>
            </ol>
          </div>
          <div className="bg-muted/50 rounded-lg p-4">
            <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              GitHub Issues
            </h4>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Go to <strong>Repository Settings &gt; Webhooks</strong></li>
              <li>Add webhook URL: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">https://workermill.com/api/webhooks/github-issues</code></li>
              <li>Select events: Issues (opened, edited, labeled)</li>
            </ol>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-foreground">Next Steps</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Link
            to="/docs/cli"
            className="bg-primary/10 border border-primary/30 rounded-xl p-5 hover:bg-primary/20 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-primary">CLI Documentation</h3>
                <p className="text-sm text-primary/70">
                  Full reference — configuration, personas, MCP servers
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-primary" />
            </div>
          </Link>
          <Link
            to="/docs/vscode-extension"
            className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                  VS Code Extension
                </h3>
                <p className="text-sm text-muted-foreground">
                  Live logs, coordination feed, and diffs in your editor
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </Link>
          <Link
            to="/docs/agent"
            className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                  Remote Agent
                </h3>
                <p className="text-sm text-muted-foreground">
                  Run workers on your machine connected to the cloud dashboard
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </Link>
          <Link
            to="/docs/mcp"
            className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                  MCP Integration
                </h3>
                <p className="text-sm text-muted-foreground">
                  Manage WorkerMill from Claude Code or other MCP clients
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </Link>
        </div>
      </section>
    </div>
  );
}
