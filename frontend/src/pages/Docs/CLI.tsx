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
          First run walks you through provider setup (Ollama auto-detected). Then just describe what you want built.
        </p>
        <p className="text-muted-foreground">
          Works with <strong className="text-foreground">Ollama</strong> (local), <strong className="text-foreground">Anthropic</strong>, <strong className="text-foreground">OpenAI</strong>, and <strong className="text-foreground">Google</strong>. No account needed.
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
            { title: "Multi-expert orchestration", desc: "Complex tasks automatically decomposed into stories, each assigned to a specialist persona (backend, frontend, devops, security, etc.)" },
            { title: "Any LLM provider", desc: "Ollama (local), Anthropic, OpenAI, Google. Per-persona model routing." },
            { title: "13 built-in tools", desc: "bash, read/write/edit files, patch, glob, grep, ls, fetch, git, web search, todo tracking, sub-agent" },
            { title: "Plan mode", desc: "Read-only research phase before making changes (/plan or --plan)" },
            { title: "Session management", desc: "Persistent conversations with resume (--resume, /sessions)" },
            { title: "Cost tracking", desc: "Per-model token pricing with /cost breakdown" },
            { title: "Quality gates", desc: "Dangerous command warnings, permission prompts, review cycles" },
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
        <CopyBlock code={`# Interactive mode\nworkermill\n\n# Skip permission prompts\nworkermill --trust\n\n# Start in read-only plan mode\nworkermill --plan\n\n# Resume last conversation\nworkermill --resume\n\n# Override provider/model\nworkermill --provider anthropic --model claude-sonnet-4-6\n\n# Auto-revise on failed reviews\nworkermill --trust --auto-revise`} />
      </section>

      {/* Multi-Expert Orchestration */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Multi-Expert Orchestration</h2>
        <p className="text-muted-foreground">For complex tasks, WorkerMill automatically:</p>
        <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
          <li><strong className="text-foreground">Classifies</strong> — Detects if the task needs multiple specialists</li>
          <li><strong className="text-foreground">Plans</strong> — Explores the codebase, designs stories with dependencies</li>
          <li><strong className="text-foreground">Executes</strong> — Each story assigned to a persona (backend_developer, frontend_developer, devops_engineer, etc.)</li>
          <li><strong className="text-foreground">Reviews</strong> — Tech lead reviews all changes, with optional revision cycles</li>
          <li><strong className="text-foreground">Commits</strong> — Stages changes and commits (with your approval)</li>
        </ol>
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
                ["/help", "Show all commands"],
                ["/plan", "Toggle read-only plan mode"],
                ["/git", "Show git branch and status"],
                ["/cost", "Token cost breakdown"],
                ["/sessions", "List, switch, or delete sessions"],
                ["/editor", "Open $EDITOR for multiline input"],
                ["/compact", "Compress conversation history"],
                ["/model", "Show current model"],
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
          Prefix <code className="text-primary">!</code> for direct bash: <code>!git status</code>, <code>!npm test</code>
        </p>
      </section>

      {/* Configuration */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Configuration</h2>
        <p className="text-muted-foreground">
          Config stored at <code className="text-primary">~/.workermill/cli.json</code> (global) and <code className="text-primary">.workermill/config.json</code> (per-project).
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
    "tech_lead": "anthropic",
    "planner": "anthropic"
  },
  "review": {
    "maxRevisions": 2,
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
            <li><strong className="text-foreground">Real services, not mocks</strong> — Docker containers for databases, caches, queues</li>
            <li><strong className="text-foreground">Version trust</strong> — Never downgrades language/runtime versions</li>
            <li><strong className="text-foreground">Right-sized plans</strong> — Planner matches complexity to task scope</li>
            <li><strong className="text-foreground">Approval bias</strong> — Tech lead only blocks on real issues, not cosmetics</li>
            <li><strong className="text-foreground">File overlap detection</strong> — Critic catches merge conflicts before they happen</li>
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
