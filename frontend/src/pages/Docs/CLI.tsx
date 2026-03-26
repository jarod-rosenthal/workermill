import { TerminalSquare, Copy, Check } from "lucide-react";
import { useState } from "react";

function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <pre className="bg-muted/50 border border-border rounded-lg p-4 font-mono text-sm overflow-x-auto">
        <code>{code}</code>
      </pre>
      <button
        onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 border border-border text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export default function CLI() {
  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <TerminalSquare className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">WorkerMill CLI</h1>
            <p className="text-muted-foreground">AI coding agent with multi-expert orchestration</p>
          </div>
        </div>
      </div>

      {/* Quick Start */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Quick Start</h2>
        <CopyBlock code="npx workermill" />
        <p className="text-muted-foreground">
          First run walks you through provider setup — choose providers for workers, planner, and reviewer independently.
          Ollama is auto-detected (including WSL). Only Node.js required.
        </p>
        <CopyBlock code="wm doctor" />
        <p className="text-muted-foreground text-sm">
          Run <code className="text-primary">wm doctor</code> to verify your setup — checks Node.js, git, Ollama, API keys, and project config.
        </p>
      </section>

      {/* Install */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Install</h2>
        <CopyBlock code={`# Run without installing\nnpx workermill\n\n# Or install globally\nnpm install -g workermill\nworkermill`} />
      </section>

      {/* Features */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Features</h2>
        <div className="grid gap-3">
          {[
            { title: "Multi-expert orchestration", desc: "/build decomposes tasks into stories, each assigned to a specialist persona with dependency ordering." },
            { title: "Quality gates", desc: "Auto-runs typecheck and lint after each story. Failures feed back to the expert for automatic retry before review." },
            { title: "Surgical review fixer", desc: "When the reviewer requests changes, a lightweight fix agent applies targeted edits before falling back to full re-execution." },
            { title: "Spec verification", desc: "Independent QA agent verifies each story's output against the original specification before review." },
            { title: "Error classification", desc: "Categorizes failures (typescript, lint, test, build, transient) with targeted fix hints for automatic retry." },
            { title: "Role-based model routing", desc: "Different models for workers, planner, and reviewer. Mix local and cloud providers." },
            { title: "WORKERMILL.md", desc: "Project instructions file read by all agents. Also supports CLAUDE.md and .cursorrules." },
            { title: "MCP servers", desc: "Connect external tools via Model Context Protocol. Configure in cli.json." },
            { title: "Hooks", desc: "Pre/post tool execution hooks for linting, formatting, and custom workflows." },
            { title: "Custom commands", desc: "Drop .md files in .workermill/commands/ to create custom slash commands." },
            { title: "Project memory", desc: "Learnings, preferences, and context persisted across sessions and injected into future builds." },
            { title: "@mentions", desc: "@file.ts inlines code, @dir/ lists tree, @https://url fetches content, @image.png sends multimodal." },
            { title: "Code review", desc: "Tech lead reads actual code diffs (not summaries), with selective revision of only affected stories." },
            { title: "Permissions", desc: "Tab to cycle: Allow → Deny → Always allow → Trust all. Per-tool allow/deny via /permissions." },
            { title: "Bash guardrails", desc: "Blocks destructive commands and writes outside the project directory." },
            { title: "13 built-in tools", desc: "bash, read/write/edit files, patch, glob, grep, ls, fetch, git, web search, todo, sub-agent." },
            { title: "Auto-update", desc: "Checks npm once per 24h and notifies when a newer version is available." },
          ].map((f) => (
            <div key={f.title} className="p-3 rounded-lg border border-border bg-card/50">
              <span className="font-medium text-foreground">{f.title}</span>
              <span className="text-muted-foreground"> — {f.desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Usage */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Usage</h2>
        <CopyBlock code={`# Interactive chat\nworkermill\n\n# Skip permission prompts\nworkermill --trust\n\n# Read-only research mode\nworkermill --plan\n\n# Resume last conversation\nworkermill --resume\n\n# Cap output tokens\nworkermill --max-tokens 4096\n\n# Then use /build inside the CLI for multi-expert orchestration\n# /build spec.md\n# /build REST API with auth, React dashboard, Docker`} />
      </section>

      {/* Multi-Expert Orchestration */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Multi-Expert Orchestration</h2>
        <p className="text-muted-foreground">Use <code className="text-primary">/build</code> to trigger multi-expert mode:</p>
        <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
          <li><strong className="text-foreground">Plans</strong> — Explores the codebase, designs stories with dependencies and persona assignments</li>
          <li><strong className="text-foreground">Executes</strong> — Each story assigned to a specialist with the full original spec and context from prior stories</li>
          <li><strong className="text-foreground">Validates</strong> — Auto-runs typecheck and lint after each story, retries with fix context on failure</li>
          <li><strong className="text-foreground">Verifies</strong> — Independent QA agent checks each story against the spec before review</li>
          <li><strong className="text-foreground">Reviews</strong> — Tech lead reads actual code diffs, requests targeted revisions on specific stories</li>
          <li><strong className="text-foreground">Fixes</strong> — Surgical fixer applies reviewer feedback directly; falls back to full re-execution only if needed</li>
          <li><strong className="text-foreground">Commits</strong> — Stages changes and commits (with your approval)</li>
        </ol>
        <p className="text-muted-foreground mt-2">
          Use <code className="text-primary">/retry</code> to re-plan the same task — the planner sees existing code and fills in gaps.
        </p>
      </section>

      {/* Commands */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Commands</h2>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Command</th>
                <th className="text-left p-3 font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["/build <task>", "Multi-expert orchestration — plans, executes, reviews"],
                ["/retry", "Re-plan and re-run the last build task"],
                ["/init", "Generate WORKERMILL.md for this project"],
                ["/settings", "View/change settings (review, ollama, etc.)"],
                ["/permissions", "Manage tool permissions (trust/ask/allow/deny)"],
                ["/undo", "Revert last build's changes (git stash or reset)"],
                ["/diff", "Preview uncommitted changes"],
                ["/model", "Show or switch model (/model provider/model)"],
                ["/plan", "Toggle read-only plan mode"],
                ["/trust", "Auto-approve all tools for this session"],
                ["/hooks", "View configured pre/post tool hooks"],
                ["/cost", "Session cost and token usage"],
                ["/status", "Session info"],
                ["/log", "Show recent CLI log entries"],
                ["/git", "Git branch and status"],
                ["/sessions", "List/switch sessions"],
                ["/editor", "Open $EDITOR for longer input"],
                ["/clear", "Reset conversation"],
                ["/quit", "Exit"],
              ].map(([cmd, desc]) => (
                <tr key={cmd}>
                  <td className="p-3 font-mono text-primary">{cmd}</td>
                  <td className="p-3 text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground">
          <strong>Shortcuts:</strong> <code className="text-primary">!command</code> runs shell directly.
          <strong> ESC</strong> cancels. <strong>ESC ESC</strong> rolls back last exchange.
          <strong> Tab</strong> cycles permission options. <strong>Ctrl+C Ctrl+C</strong> exits.
        </p>
      </section>

      {/* Settings */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Settings</h2>
        <p className="text-muted-foreground">
          Use <code className="text-primary">/settings</code> to view all settings, or <code className="text-primary">/settings key value</code> to change one.
        </p>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Setting</th>
                <th className="text-left p-3 font-medium">Default</th>
                <th className="text-left p-3 font-medium">Command</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["Ollama host", "auto-detected", "/settings ollama.host <url>"],
                ["Ollama context", "65536", "/settings ollama.context <n>"],
                ["Review enabled", "true", "/settings review.enabled true/false"],
                ["Max revisions", "3", "/settings review.maxRevisions <n>"],
                ["Approval threshold", "80", "/settings review.threshold <n>"],
                ["Auto-revise", "false", "/settings review.autoRevise true/false"],
                ["Critic pass", "false", "/settings review.critic true/false"],
              ].map(([setting, def, cmd]) => (
                <tr key={setting}>
                  <td className="p-3 font-medium text-foreground">{setting}</td>
                  <td className="p-3 text-muted-foreground">{def}</td>
                  <td className="p-3 font-mono text-primary text-xs">{cmd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Configuration */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Configuration</h2>

        <h3 className="text-lg font-semibold mt-4">Files</h3>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">File</th>
                <th className="text-left p-3 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["WORKERMILL.md", "Project instructions — read by all agents (committed to repo)"],
                ["~/.workermill/cli.json", "Global config (providers, routing, review, hooks, MCP)"],
                [".workermill/config.json", "Per-project config overrides"],
                [".workermill/commands/*.md", "Custom slash commands"],
                [".workermill/personas/*.md", "Custom persona overrides"],
                ["~/.workermill/memory/", "Project memory — learnings, preferences, context (per-project)"],
              ].map(([file, purpose]) => (
                <tr key={file}>
                  <td className="p-3 font-mono text-primary text-xs">{file}</td>
                  <td className="p-3 text-muted-foreground">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-lg font-semibold mt-4">Example Config</h3>
        <CopyBlock code={`{
  "providers": {
    "ollama": {
      "model": "qwen3-coder:30b",
      "host": "http://localhost:11434",
      "contextLength": 65536
    },
    "anthropic": {
      "model": "claude-sonnet-4-6",
      "apiKey": "{env:ANTHROPIC_API_KEY}"
    },
    "google": {
      "model": "gemini-3.1-pro-preview",
      "apiKey": "{env:GOOGLE_API_KEY}"
    }
  },
  "default": "ollama",
  "routing": {
    "planner": "google",
    "tech_lead": "anthropic"
  },
  "review": {
    "enabled": true,
    "maxRevisions": 3,
    "approvalThreshold": 80
  },
  "hooks": {
    "post": [
      { "command": "npx eslint --fix", "tools": ["write_file", "edit_file"] }
    ]
  },
  "mcp": {
    "my-server": { "command": "npx", "args": ["-y", "my-mcp-server"] }
  }
}`} />
      </section>

      {/* Personas */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">12 Built-in Personas</h2>
        <div className="flex flex-wrap gap-2">
          {[
            { name: "Backend Developer", emoji: "\u{1F4BB}" },
            { name: "Frontend Developer", emoji: "\u{1F3A8}" },
            { name: "DevOps Engineer", emoji: "\u{1F527}" },
            { name: "QA Engineer", emoji: "\u{1F9EA}" },
            { name: "Security Engineer", emoji: "\u{1F512}" },
            { name: "Data & ML Engineer", emoji: "\u{1F4CA}" },
            { name: "Mobile Developer", emoji: "\u{1F4F1}" },
            { name: "Tech Writer", emoji: "\u{1F4DD}" },
            { name: "Architect", emoji: "\u{1F3D7}\uFE0F" },
            { name: "Tech Lead", emoji: "\u{1F451}" },
            { name: "Planner", emoji: "\u{1F4A1}" },
            { name: "Critic", emoji: "\u{1F50D}" },
          ].map((p) => (
            <span key={p.name} className="px-3 py-1.5 rounded-full border border-border bg-card/50 text-sm">
              {p.emoji} {p.name}
            </span>
          ))}
        </div>
        <div className="space-y-2 mt-4">
          <p className="text-sm text-muted-foreground">
            All personas include production-hardened rules:
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
            <li><strong className="text-foreground">Full spec context</strong> — Every worker sees the complete original specification</li>
            <li><strong className="text-foreground">Quality gates</strong> — Typecheck and lint run automatically after each story, with auto-retry on failure</li>
            <li><strong className="text-foreground">Sibling awareness</strong> — Workers see files created and decisions made by prior experts</li>
            <li><strong className="text-foreground">Real services, not mocks</strong> — Docker containers for databases, caches, queues</li>
            <li><strong className="text-foreground">Version trust</strong> — Never downgrades language/runtime versions</li>
            <li><strong className="text-foreground">Code-level review</strong> — Tech lead reads actual diffs, requests changes on specific stories only</li>
            <li><strong className="text-foreground">Sandboxed execution</strong> — Workers stay in the project directory, destructive commands blocked</li>
            <li><strong className="text-foreground">Project memory</strong> — Learnings and context persisted across sessions</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Custom personas: add <code className="text-primary">.workermill/personas/my_persona.md</code> to your project.
          </p>
        </div>
      </section>

      {/* Requirements */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Requirements</h2>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li>Node.js 20+</li>
          <li>An LLM provider (Ollama for local, or an API key for cloud providers)</li>
        </ul>
      </section>
    </div>
  );
}
