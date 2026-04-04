import { TerminalSquare, Copy, Check, BookOpen } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

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
            { title: "Architect-led planning", desc: "The planner reads your codebase — patterns, conventions, architecture — then briefs each worker with specific files to follow, integration points, and risks. Workers write code that fits your project, not generic boilerplate." },
            { title: "Multi-expert orchestration", desc: "/ship decomposes tasks into stories, each assigned to a specialist persona with the planner's architectural guidance." },
            { title: "Feasibility gate", desc: "The planner rejects tasks that are too vague or contradictory before any worker tokens are spent." },
            { title: "Git branch isolation", desc: "Each /ship session creates a feature branch with commits per story. Clean diffs for review, checkpoints for rollback." },
            { title: "Revision with memory", desc: "When the reviewer requests changes, workers see what they tried last time via git history — no repeated mistakes." },
            { title: "Error classification", desc: "Categorizes failures (typescript, lint, test, build, transient) with targeted fix hints for automatic retry." },
            { title: "Per-persona model routing", desc: "Map any persona to any provider. Run security reviews on Claude, frontend on GPT, workers on Ollama — /settings route <persona> <provider>." },
            { title: "WORKERMILL.md", desc: "Project instructions file read by all agents. Also supports CLAUDE.md and .cursorrules." },
            { title: "MCP servers", desc: "Connect external tools via Model Context Protocol. Configure in cli.json." },
            { title: "Hooks", desc: "Pre/post tool execution hooks for linting, formatting, and custom workflows." },
            { title: "Custom commands", desc: "Drop .md files in .workermill/commands/ to create custom slash commands." },
            { title: "Project memory", desc: "Learnings, preferences, and context persisted across sessions and injected into future builds." },
            { title: "@mentions", desc: "@file.ts inlines code, @dir/ lists tree, @https://url fetches content, @image.png sends multimodal." },
            { title: "Code review", desc: "Tech lead reads actual code diffs (not summaries), with selective revision of only affected stories." },
            { title: "Permissions", desc: "Shift+Tab to cycle: Ask → Auto-edit → Trust all. Per-tool always-allow from prompt. Per-tool allow/deny via /permissions." },
            { title: "Bash guardrails", desc: "Blocks destructive commands and writes outside the project directory." },
            { title: "Built-in tools", desc: "bash, read/write/edit files, patch, glob, grep, ls, fetch, git, web search, todo, verify, sub-agent, plus 8 browser tools." },
            { title: "Live model switching", desc: "/model hot-swaps provider and model mid-session. Autocomplete shows all available models. Auto-compacts when switching to a smaller context window." },
            { title: "Status bar", desc: "Shows active model with context window size, usage percentage, cost estimate, git branch, and tokens/sec." },
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
        <CopyBlock code={`# Interactive chat\nworkermill\n\n# Skip permission prompts\nworkermill --trust\n\n# Resume last conversation\nworkermill --resume\n\n# Cap output tokens\nworkermill --max-tokens 4096\n\n# Then use /ship inside the CLI for multi-expert orchestration\n# /ship spec.md\n# /ship REST API with auth, React dashboard, Docker`} />
      </section>

      {/* Multi-Expert Orchestration */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Multi-Expert Orchestration</h2>
        <p className="text-muted-foreground">Use <code className="text-primary">/ship</code> to trigger multi-expert mode:</p>
        <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
          <li><strong className="text-foreground">Analyzes</strong> — Planner reads your codebase deeply: patterns, conventions, frameworks, dependencies, risks</li>
          <li><strong className="text-foreground">Plans</strong> — Decomposes the task into stories with target files, reference patterns, and implementation guidance per worker</li>
          <li><strong className="text-foreground">Executes</strong> — Each specialist gets the planner{"'"}s brief: which files to follow, which patterns to use, what risks to watch for. Each story is committed to the feature branch.</li>
          <li><strong className="text-foreground">Reviews</strong> — Tech lead reviews the plan and the code. On revision rounds, sees what changed since the last review — not the full diff again.</li>
          <li><strong className="text-foreground">Revises</strong> — Workers get per-story feedback plus their own git history from the previous attempt. They fix what was flagged without repeating the same mistakes.</li>
          <li><strong className="text-foreground">Commits</strong> — All work is on a feature branch with per-story commits. Ready for your review.</li>
        </ol>
        <p className="text-muted-foreground mt-2">
          Use <code className="text-primary">/retry</code> to resume an incomplete <code className="text-primary">/ship</code> — skips planning and picks up from the first incomplete story.
        </p>
      </section>

      {/* The Planner */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">The Planner</h2>
        <p className="text-muted-foreground">
          The planner is the most important step in <code className="text-primary">/ship</code>. It reads your codebase so your workers don{"'"}t have to.
        </p>
        <div className="space-y-3">
          <div className="p-4 rounded-lg border border-border bg-card/50">
            <h3 className="font-semibold text-foreground mb-2">What the planner does</h3>
            <ul className="list-disc list-inside space-y-1.5 text-sm text-muted-foreground">
              <li>Reads key files — models, routes, config, package.json — to understand how your project is built</li>
              <li>Identifies 2-3 existing files that are most similar to what needs to be built. These become reference patterns.</li>
              <li>Decomposes the task into the minimum number of stories, grouped by persona (one backend story, one frontend story — not ten tiny steps)</li>
              <li>Writes <strong className="text-foreground">implementationNotes</strong> per story: {"\""}follow the pattern in products.py, use the Depends(get_db) middleware, dispatch webhooks after the transaction commits{"\""}  </li>
              <li>Can <strong className="text-foreground">reject</strong> a task if the spec is too vague or contradicts the codebase — saving all downstream worker tokens</li>
            </ul>
          </div>
          <div className="p-4 rounded-lg border border-border bg-card/50">
            <h3 className="font-semibold text-foreground mb-2">Why this matters</h3>
            <p className="text-sm text-muted-foreground">
              Without the planner, each worker starts from zero — exploring the codebase, guessing at patterns, and writing code that doesn{"'"}t fit.
              With the planner, workers get a specific brief: which files to read, which conventions to follow, and what risks to avoid.
              The result is code that looks like your team wrote it, not generic AI output.
            </p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-card/50">
            <h3 className="font-semibold text-foreground mb-2">Use a flagship model</h3>
            <p className="text-sm text-muted-foreground">
              The planner benefits most from a capable model. Use <code className="text-primary">/settings route planner &lt;provider&gt;</code> to route the planner to a flagship model
              (Claude Sonnet, GPT-5.4, Gemini Pro) while keeping workers on a local model like Ollama. The planner runs once per task — the investment pays for itself in better worker output.
            </p>
          </div>
        </div>
      </section>

      {/* The Reviewer */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">The Reviewer</h2>
        <p className="text-muted-foreground">
          After all stories complete, the tech lead reviews the work. The reviewer is the quality gate between {"\""}code written{"\""} and {"\""}code shipped.{"\""}
        </p>
        <div className="space-y-3">
          <div className="p-4 rounded-lg border border-border bg-card/50">
            <h3 className="font-semibold text-foreground mb-2">What the reviewer does</h3>
            <ul className="list-disc list-inside space-y-1.5 text-sm text-muted-foreground">
              <li>Reviews against <strong className="text-foreground">the plan</strong>, not just the raw spec — the same source of truth the workers used</li>
              <li>Reads the git diff from the feature branch, plus uses tools (read_file, grep, glob) to inspect specific files — <strong className="text-foreground">requires Git</strong> to generate diffs for review</li>
              <li>Identifies which stories need revision and provides <strong className="text-foreground">per-story feedback</strong> — only affected stories re-run</li>
              <li>On revision rounds, sees <strong className="text-foreground">what changed since the last review</strong> — evaluates progress, not the full codebase from scratch</li>
              <li>Configurable approval threshold (default 8/10) — scores at or above auto-approve, cosmetic issues go in feedback comments, not revision requests</li>
              <li>Configurable max revision rounds (default 3) — prevents infinite review loops</li>
              <li>Breaks deadlocks — if the same issue persists across rounds, accepts best effort instead of looping forever</li>
            </ul>
          </div>
          <div className="p-4 rounded-lg border border-border bg-card/50">
            <h3 className="font-semibold text-foreground mb-2">Why this matters</h3>
            <p className="text-sm text-muted-foreground">
              Without review, workers ship whatever they produce — broken imports, missing error handling, code that doesn{"'"}t match the plan.
              The reviewer catches functional bugs and security issues before the code reaches you. And because it works from the same plan
              the workers followed, it evaluates what was actually asked for — not an independent interpretation of the spec.
            </p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-card/50">
            <h3 className="font-semibold text-foreground mb-2">Use a capable model</h3>
            <p className="text-sm text-muted-foreground">
              Like the planner, the reviewer benefits from a capable model. A stronger reviewer catches real issues on the first pass,
              reducing revision cycles. Use <code className="text-primary">/setup</code> to route the reviewer to a flagship model independently.
              The reviewer runs once per review round — fewer rounds means lower total cost.
            </p>
          </div>
        </div>
      </section>

      {/* The Workers */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">The Workers</h2>
        <p className="text-muted-foreground">
          Workers are the specialist personas that write the actual code — backend developers, frontend developers, DevOps engineers, and more.
        </p>
        <div className="space-y-3">
          <div className="p-4 rounded-lg border border-border bg-card/50">
            <h3 className="font-semibold text-foreground mb-2">Local models, flagship quality</h3>
            <p className="text-sm text-muted-foreground">
              The workers don{"'"}t need to be the smartest model in the room. They need to follow instructions, use tools, and write code.
              A local model like Ollama{"'"}s Qwen Coder running on your machine can do that — especially when it{"'"}s been handed a clear brief
              by a flagship planner and its output is held to a standard by a flagship reviewer.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              This is the core insight: <strong className="text-foreground">the quality of the output is set by the planner and the reviewer, not the worker.</strong> The
              planner tells the worker exactly which files to follow and which patterns to use. The reviewer holds the worker accountable to
              that plan. A local model doing the work with a flagship model setting the direction and enforcing the standard produces better
              results than a flagship model working alone with no plan and no review.
            </p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-card/50">
            <h3 className="font-semibold text-foreground mb-2">Why this saves money</h3>
            <p className="text-sm text-muted-foreground">
              Workers consume the most tokens by far — they read files, write code, run commands, and iterate. Running that volume through a cloud
              API adds up fast. With local models handling the heavy lifting and flagship models only running for planning (once) and review
              (once per round), you get the quality ceiling of the flagship without paying flagship rates on every tool call.
            </p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-card/50">
            <h3 className="font-semibold text-foreground mb-2">15+ tools at their disposal</h3>
            <p className="text-sm text-muted-foreground">
              Workers have full access to your development environment: bash, read/write/edit files, glob, grep, git, web search, and more.
              They can install dependencies, run tests, check compilation, and verify their own work — just like a developer at a terminal.
            </p>
          </div>
        </div>
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
                ["/ship <task>", "Multi-expert orchestration — plans, executes, reviews"],
                ["/review [task]", "Code review using the tech lead (defaults to recent changes)"],
                ["/retry", "Re-plan and re-run the last build task"],
                ["/init", "Generate WORKERMILL.md for this project"],
                ["/settings", "View/change settings (review, ollama, etc.)"],
                ["/permissions", "Manage tool permissions (trust/ask/allow/deny)"],
                ["/undo", "Revert last build's changes (git stash or reset)"],
                ["/diff", "Preview uncommitted changes"],
                ["/model [provider/model] [context]", "Switch model mid-session with autocomplete and auto-compact"],
                ["/compact [focus]", "Compact conversation (e.g. /compact focus on API changes)"],
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
                ["Approval threshold", "8", "/settings review.threshold <n> (1-10 scale)"],
                ["Auto-revise", "false", "/settings review.autoRevise true/false"],
                ["Persona routing", "default provider", "/settings route <persona> <provider>"],
                ["API key", "\u2014", "/settings key <provider> <api-key>"],
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
    "tech_lead": "anthropic",
    "security_engineer": "anthropic"
  },
  "review": {
    "enabled": true,
    "maxRevisions": 3,
    "approvalThreshold": 8
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
        <h2 className="text-2xl font-semibold">Built-in Personas</h2>
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
            <li><strong className="text-foreground">Isolated execution</strong> — Workers execute in isolated environments with full tool access</li>
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
          <li>Git</li>
          <li>An LLM provider (Ollama for local, or an API key for cloud providers)</li>
          <li><a href="https://cli.github.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">GitHub CLI</a> (<code className="px-1 bg-muted rounded text-xs">gh</code>) — optional, needed for automatic PR creation</li>
        </ul>
      </section>

      {/* Deep reference */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Deep Reference</h2>
        <p className="text-muted-foreground">
          Every slash command, every configuration field, and guides for extending the CLI with custom personas, hooks, and skills.
        </p>
        <Link
          to="/docs/cli/reference"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors"
        >
          <BookOpen className="w-4 h-4 text-primary" />
          <span>Browse CLI Reference</span>
        </Link>
      </section>
    </div>
  );
}
