import { useRef, useEffect, useState } from "react";
import { Copy, CheckCircle, Terminal, Monitor, ArrowRight, BookOpen, Clock, Github, Star, ExternalLink, Download, Layers, MessageSquare, GitBranch, Users, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { ImmersiveBackground } from "./Home/v0/ImmersiveBackground";
import { Header } from "./Home/v0/Header";
import ShowcaseGallery from "../components/ShowcaseGallery";
import ExecutionShowcase from "../components/ExecutionShowcase";
import TrustCallout from "../components/TrustCallout";
import { Demos } from "./Home/Demos";

import { getFeaturedPost } from "../content/blog/posts";

// ─── Social Proof Stats ─────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K+`;
  return `${n}+`;
}

function SocialProof() {
  const [downloads, setDownloads] = useState<number | null>(null);
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    // Fetch total downloads from npm (all time — from first publish to today)
    const today = new Date().toISOString().split("T")[0];
    fetch(`https://api.npmjs.org/downloads/point/2026-01-01:${today}/workermill`)
      .then((r) => r.json())
      .then((d) => { if (d.downloads) setDownloads(d.downloads); })
      .catch(() => {});

    // Fetch stars from GitHub
    fetch("https://api.github.com/repos/jarod-rosenthal/workermill")
      .then((r) => r.json())
      .then((d) => { if (d.stargazers_count) setStars(d.stargazers_count); })
      .catch(() => {});
  }, []);

  return (
    <div className="mt-8 flex items-center justify-center gap-8 sm:gap-12">
      <a
        href="https://www.npmjs.com/package/workermill"
        target="_blank"
        rel="noopener noreferrer"
        className="group flex flex-col items-center gap-1 hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4 text-teal-400" />
          <span className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent">
            {downloads !== null ? formatNumber(downloads) : "—"}
          </span>
        </div>
        <span className="text-xs text-slate-500 uppercase tracking-widest">downloads</span>
      </a>

      <div className="w-px h-10 bg-white/10" />

      <a
        href="https://github.com/jarod-rosenthal/workermill/stargazers"
        target="_blank"
        rel="noopener noreferrer"
        className="group flex flex-col items-center gap-1 hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-400" />
          <span className="text-2xl sm:text-3xl font-bold text-white">
            {stars !== null ? formatNumber(stars) : "—"}
          </span>
        </div>
        <span className="text-xs text-slate-500 uppercase tracking-widest">GitHub stars</span>
      </a>

      <div className="w-px h-10 bg-white/10" />

      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-violet-400" />
          <span className="text-2xl sm:text-3xl font-bold text-white">Any</span>
        </div>
        <span className="text-xs text-slate-500 uppercase tracking-widest">LLM provider</span>
      </div>
    </div>
  );
}

// ─── Featured Article ────────────────────────────────────────────────────────

function FeaturedArticle() {
  const post = getFeaturedPost();
  if (!post) return null;

  return (
    <section className="relative py-20">
      <div className="container mx-auto px-6 lg:px-8 max-w-5xl">
        <div className="text-center mb-10">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-teal-400 mb-3">
            <BookOpen className="w-3.5 h-3.5" />
            From Our Blog
          </span>
          <h2 className="text-2xl md:text-3xl font-bold text-foreground">
            Latest Thinking
          </h2>
        </div>

        <Link
          to={`/blog/${post.slug}`}
          className="group block rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden hover:border-teal-500/30 transition-all duration-300"
        >
          <div className="grid md:grid-cols-[1fr,1.2fr] gap-0">
            {/* Thumbnail */}
            <div className="aspect-[16/9] md:aspect-auto overflow-hidden">
              <img
                src={post.thumbnail}
                alt={post.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
            </div>

            {/* Content */}
            <div className="p-8 md:p-10 flex flex-col justify-center">
              <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
                <span className="px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 font-medium uppercase tracking-wide">
                  {post.category.replace("-", " ")}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {post.readingTime} min read
                </span>
              </div>

              <h3 className="text-xl md:text-2xl font-bold text-foreground mb-3 group-hover:text-teal-400 transition-colors leading-tight">
                {post.title}
              </h3>

              <p className="text-sm text-muted-foreground leading-relaxed mb-6 line-clamp-3">
                {post.excerpt}
              </p>

              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  <span className="text-foreground/80 font-medium">{post.author.name}</span>
                  {" · "}
                  {new Date(post.date).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
                <span className="flex items-center gap-1 text-sm font-medium text-teal-400 group-hover:gap-2 transition-all">
                  Read article
                  <ArrowRight className="w-4 h-4" />
                </span>
              </div>
            </div>
          </div>
        </Link>
      </div>
    </section>
  );
}

// ─── Open Source Banner ─────────────────────────────────────────────────────

function OpenSourceBanner() {
  return (
    <section className="relative py-20 px-6">
      <div className="relative max-w-3xl mx-auto text-center">
        {/* GitHub icon */}
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/[0.06] border border-white/10 mb-6">
          <Github className="w-7 h-7 text-white" />
        </div>

        <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
          Open source.{" "}
          <span className="bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent">
            Always.
          </span>
        </h2>
        <p className="text-slate-400 max-w-xl mx-auto leading-relaxed mb-8">
          WorkerMill is fully open source under the Apache 2.0 license.
          Read the code, run it yourself, or contribute — no black boxes.
        </p>

        {/* CTA row */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href="https://github.com/jarod-rosenthal/workermill"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-white text-black font-semibold text-sm hover:bg-slate-200 transition-colors"
          >
            <Github className="w-4 h-4" />
            View on GitHub
            <ExternalLink className="w-3.5 h-3.5 opacity-50" />
          </a>
          <a
            href="https://github.com/jarod-rosenthal/workermill/stargazers"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-white/10 bg-white/[0.03] text-slate-300 text-sm font-medium hover:bg-white/[0.06] hover:text-white transition-colors"
          >
            <Star className="w-4 h-4 text-amber-400" />
            Star the repo
          </a>
        </div>

        {/* License badge */}
        <p className="mt-6 text-xs text-slate-500">
          Licensed under{" "}
          <a
            href="https://github.com/jarod-rosenthal/workermill/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-white transition-colors underline underline-offset-2"
          >
            Apache 2.0
          </a>
          {" · "}
          Contributions welcome
        </p>
      </div>
    </section>
  );
}

// ─── Install Section ─────────────────────────────────────────────────────────

function InstallSection() {
  const [copied, setCopied] = useState<string | null>(null);
  const [_platform, _setPlatform] = useState<"unix" | "windows">("unix");

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const _installCommands = {
    unix: "curl -fsSL https://workermill.com/install.sh | bash",
    windows: "irm https://workermill.com/install.ps1 | iex",
  };

  return (
    <section className="relative pb-20 pt-4">
      <div className="container mx-auto px-6 lg:px-8 max-w-4xl">
        {/* Two cards side by side */}
        <div className="grid md:grid-cols-2 gap-6">

          {/* CLI Install */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center">
                <Terminal className="w-5 h-5 text-teal-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">WorkerMill CLI</h3>
                <p className="text-xs text-slate-500">Multi-expert AI coding agent</p>
              </div>
            </div>

            {/* Command */}
            <div className="bg-black/40 rounded-lg p-3.5 font-mono text-sm flex items-center justify-between gap-3 border border-white/5">
              <code className="text-teal-300 text-xs sm:text-sm truncate">
                npx workermill
              </code>
              <button
                onClick={() => copyToClipboard("npx workermill", "cli-install")}
                className="text-slate-500 hover:text-white transition-colors flex-shrink-0"
              >
                {copied === "cli-install" ? (
                  <CheckCircle className="w-4 h-4 text-teal-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>

            <div className="text-xs text-slate-500 space-y-1">
              <p>Works with Ollama (local), Anthropic, OpenAI, and Google.</p>
              <p>First run auto-detects Ollama and walks you through setup.</p>
              <p>No account needed — just Node.js 20+.</p>
            </div>

            <Link
              to="/docs/cli"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-400 hover:text-teal-300 transition-colors"
            >
              CLI documentation
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {/* VS Code Extension */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Monitor className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">VS Code Extension</h3>
                <p className="text-xs text-slate-500">Monitor and control from your editor</p>
              </div>
            </div>

            <p className="text-sm text-slate-400">
              Search the Extensions panel for <span className="text-white font-medium">WorkerMill</span> and
              click Install. Or run from the command palette:
            </p>

            {/* Install command */}
            <div className="bg-black/40 rounded-lg p-3.5 font-mono text-sm flex items-center justify-between gap-3 border border-white/5">
              <code className="text-blue-300 text-xs sm:text-sm">
                ext install workermill.workermill
              </code>
              <button
                onClick={() => copyToClipboard("ext install workermill.workermill", "vscode-install")}
                className="text-slate-500 hover:text-white transition-colors flex-shrink-0"
              >
                {copied === "vscode-install" ? (
                  <CheckCircle className="w-4 h-4 text-blue-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* What you get */}
            <ul className="text-xs text-slate-500 space-y-1.5">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-blue-400/60 mt-0.5 flex-shrink-0" />
                <span>Live task sidebar with active, backlog, and recent</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-blue-400/60 mt-0.5 flex-shrink-0" />
                <span>Real-time log streaming in terminal tabs</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-blue-400/60 mt-0.5 flex-shrink-0" />
                <span>Run Jira issues, approve plans, respond to blockers</span>
              </li>
            </ul>

            <Link
              to="/docs/vscode-extension"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
            >
              Extension documentation
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Platform note */}
        <p className="mt-6 text-center text-sm text-slate-500">
          Runs on macOS, Linux, and Windows &mdash; works with{" "}
          <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors underline underline-offset-2">Ollama</a>{" (local), "}
          <a href="https://www.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors underline underline-offset-2">Anthropic</a>{", "}
          <a href="https://openai.com" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors underline underline-offset-2">OpenAI</a>{", "}
          <a href="https://ai.google.dev" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors underline underline-offset-2">Google</a>{", "}
          <a href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors underline underline-offset-2">LM Studio</a>
          {", and any OpenAI-compatible provider — "}
          Groq, DeepSeek, Mistral, OpenRouter, Together AI, xAI, or your own endpoint.
        </p>
      </div>
    </section>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function LandingV0() {
  // Refs for scroll targets
  const topRef = useRef<HTMLDivElement>(null);
  const showcaseRef = useRef<HTMLDivElement>(null);

  // Handle hash-based scrolling when navigating from other routes (e.g. /showcase/:id → /#showcase)
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash) {
      const el = document.getElementById(hash);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 100);
      }
    }
  }, []);

  return (
    <main className="min-h-screen relative overflow-hidden">
      <ImmersiveBackground />

      <div className="relative z-10">
        <Header />

        {/* Main content */}
        <div>
          {/* Hero headline */}
          <section ref={topRef} className="relative pt-10 lg:pt-16 pb-16">
            <div className="container mx-auto px-6 lg:px-8">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-[1.1] text-center">
                Your backlog,{" "}
                <span className="bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent">
                  shipped overnight.
                </span>
              </h1>
              <p className="mt-6 text-xl text-slate-400 max-w-3xl mx-auto text-center leading-relaxed">
                Open-source AI coding team with multi-expert orchestration. Works with any LLM.
              </p>
              {/* Social proof stats */}
              <SocialProof />
            </div>
          </section>

          {/* How it works */}
          <section className="relative py-16">
            <div className="container mx-auto px-6 lg:px-8 max-w-5xl">

              {/* How it works steps */}
              <div className="grid md:grid-cols-4 gap-6 mb-16">
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/20 mb-4">
                    <MessageSquare className="w-6 h-6 text-teal-400" />
                  </div>
                  <div className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-2">Step 1</div>
                  <h3 className="text-lg font-semibold text-white mb-2">Describe the task</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    A bug fix, a new feature, or a full product. Plain English.
                  </p>
                </div>

                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 mb-4">
                    <GitBranch className="w-6 h-6 text-violet-400" />
                  </div>
                  <div className="text-xs font-bold text-violet-400 uppercase tracking-widest mb-2">Step 2</div>
                  <h3 className="text-lg font-semibold text-white mb-2">Coordinator plans</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Breaks the work into tasks and assigns the right expert agents.
                  </p>
                </div>

                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 mb-4">
                    <Users className="w-6 h-6 text-blue-400" />
                  </div>
                  <div className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2">Step 3</div>
                  <h3 className="text-lg font-semibold text-white mb-2">Experts execute</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Backend, frontend, DevOps, QA, security — working in parallel on your codebase.
                  </p>
                </div>

                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-4">
                    <Zap className="w-6 h-6 text-amber-400" />
                  </div>
                  <div className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-2">Step 4</div>
                  <h3 className="text-lg font-semibold text-white mb-2">You review</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Code is committed, tests pass, PR is ready. You approve and merge.
                  </p>
                </div>
              </div>

              {/* Key differentiators */}
              <div className="grid md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
                  <h4 className="text-sm font-semibold text-white mb-1">Any LLM provider</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Ollama, Anthropic, OpenAI, Google, LM Studio, or any OpenAI-compatible endpoint. Your models, your keys.
                  </p>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
                  <h4 className="text-sm font-semibold text-white mb-1">Runs locally</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    No account, no cloud, no data leaves your machine. Just Node.js and <code className="text-slate-400">npx workermill</code>.
                  </p>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
                  <h4 className="text-sm font-semibold text-white mb-1">Specialized expert personas</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Architect, backend, frontend, DevOps, QA, security, mobile, data/ML, tech lead, and more — each with role-specific directives.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Interactive execution showcase */}
          <ExecutionShowcase />

          {/* Proof — live projects with real metrics */}
          <div id="showcase" ref={showcaseRef}>
            <ShowcaseGallery />
          </div>

          {/* Demo Videos */}
          <div id="demos">
            <Demos />
          </div>

          {/* Featured Article */}
          <FeaturedArticle />

          {/* Trust & Security */}
          <TrustCallout />

          {/* Open Source */}
          <OpenSourceBanner />

          {/* Now they're convinced — show how to get started */}
          <div id="downloads">
            <InstallSection />
          </div>

          {/* Contact */}
          <section className="relative py-20 px-6">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
                Get in Touch
              </h2>
              <p className="text-slate-400 max-w-xl mx-auto leading-relaxed mb-8">
                Questions, feedback, or inquiries — I'd love to hear from you.
              </p>
              <a
                href="mailto:jarod.rosenthal@protonmail.com"
                className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl border border-white/10 bg-white/[0.03] text-slate-300 text-sm font-medium hover:bg-white/[0.06] hover:text-white transition-colors"
              >
                jarod.rosenthal@protonmail.com
              </a>
            </div>
          </section>

        </div>
      </div>
    </main>
  );
}
