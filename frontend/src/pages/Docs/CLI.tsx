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
          Ollama is auto-detected (including WSL). Then just describe what you want built.
        </p>
        <p className="text-muted-foreground">
          Works with <strong className="text-foreground">Ollama</strong> (local), <strong className="text-foreground">Anthropic</strong>, <strong className="text-foreground">OpenAI</strong>, and <strong className="text-foreground">Google</strong>. Only Node.js required.
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
            { title: "Multi-expert orchestration", desc: "Complex tasks decomposed into stories, each assigned to a specialist persona (backend, frontend, devops, security, etc.)" },
            { title: "Any LLM provider", desc: "Ollama (local), Anthropic, OpenAI, Google. Per-role model routing — use different models for workers, planner, and reviewer." },
            { title: "Role-based setup", desc: "Choose providers independently for workers (build code), planner (design stories), and reviewer (check quality)." },
            { title: "13 built-in tools", desc: "bash, read/write/edit files, patch, glob, grep, ls, fetch, git, web search, todo tracking, sub-agent" },
            { title: "Live status bar", desc: "Animated spinner with persona activity, context usage, live cost tracking, and git branch." },
            { title: "In-app settings", desc: "Change Ollama host, review thresholds, revision limits, and more with /settings — no config file editing needed." },
            { title: "Session management", desc: "Persistent conversations with resume (--resume, /sessions)" },
            { title: "Cost tracking", desc: "Per-model token pricing in the status bar with /cost breakdown" },
            { title: "Code review with revisions", desc: "Tech lead reviews actual code (not summaries), with configurable revision cycles and approval threshold." },
            { title: "Bash guardrails", desc: "Blocks destructive commands (rm -rf /, sudo, git push --force) and writes outside the project directory." },
            { title: "Git integration", desc: "Auto-init repos, branch awareness, commit after orchestration" },
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
        <CopyBlock code={`# Interactive mode\nworkermill\n\n# Skip permission prompts\nworkermill --trust\n\n# Start in read-only plan mode\nworkermill --plan\n\n# Resume last conversation\nworkermill --resume\n\n# Override provider/model\nworkermill --provider anthropic --model claude-sonnet-4-6\n\n# Build from a spec file\nwm build spec.md\n\n# Build from inline description\nwm build "REST API with auth, React dashboard, Docker"`} />
      </section>

      {/* Multi-Expert Orchestration */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Multi-Expert Orchestration</h2>
        <p className="text-muted-foreground">Use <code className="text-primary">/build</code> to trigger multi-expert mode. WorkerMill:</p>
        <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
          <li><strong className="text-foreground">Plans</strong> — Explores the codebase, designs stories with dependencies and persona assignments</li>
          <li><strong className="text-foreground">Executes</strong> — Each story assigned to a specialist persona with the full original spec</li>
          <li><strong className="text-foreground">Reviews</strong> — Tech lead reads the actual code and scores it, with revision cycles</li>
          <li><strong className="text-foreground">Commits</strong> — Stages changes and commits (with your approval)</li>
        </ol>
        <p className="text-muted-foreground mt-2">
          Use <code className="text-primary">/retry</code> to re-plan and re-run the same task — the planner sees what already exists and fills in the gaps.
        </p>
      </section>

      {/* Slash Commands */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Slash Commands</h2>
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
                ["/settings", "View/change settings (review, ollama, etc.)"],
                ["/help", "Show all commands"],
                ["/plan", "Toggle read-only plan mode"],
                ["/trust", "Auto-approve all tool calls for this session"],
                ["/git", "Show git branch and status"],
                ["/cost", "Token cost breakdown"],
                ["/model", "Show current provider and model"],
                ["/sessions", "List, switch, or delete sessions"],
                ["/editor", "Open $EDITOR for multiline input"],
                ["/status", "Session stats"],
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
          Prefix <code className="text-primary">!</code> for direct bash: <code>!git status</code>, <code>!npm test</code>.
          Press <strong>ESC</strong> to cancel a running agent or build.
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
        <h2 className="text-2xl font-semibold">Configuration File</h2>
        <p className="text-muted-foreground">
          Config stored at <code className="text-primary">~/.workermill/cli.json</code> (global) and <code className="text-primary">.workermill/config.json</code> (per-project override).
        </p>
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
    "openai": {
      "model": "gpt-5.4",
      "apiKey": "{env:OPENAI_API_KEY}"
    },
    "google": {
      "model": "gemini-3.1-pro",
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
    "autoRevise": false,
    "approvalThreshold": 80
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
            All personas include production-hardened rules from WorkerMill's cloud platform:
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
            <li><strong className="text-foreground">Full spec context</strong> — Every worker sees the complete original specification</li>
            <li><strong className="text-foreground">Real services, not mocks</strong> — Docker containers for databases, caches, queues</li>
            <li><strong className="text-foreground">Version trust</strong> — Never downgrades language/runtime versions</li>
            <li><strong className="text-foreground">Right-sized plans</strong> — Planner matches complexity to task scope</li>
            <li><strong className="text-foreground">Code-level review</strong> — Tech lead reads actual diffs, not summaries</li>
            <li><strong className="text-foreground">Sandboxed execution</strong> — Workers stay in the project directory, destructive commands blocked</li>
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
