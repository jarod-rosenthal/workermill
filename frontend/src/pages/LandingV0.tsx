import { useRef, useEffect, useState } from "react";
import { Copy, CheckCircle, Terminal, Github, Star, ExternalLink, Download, MessageSquare, GitBranch, Users, Zap, Wrench } from "lucide-react";
import { ImmersiveBackground } from "./Home/v0/ImmersiveBackground";
import { Header } from "./Home/v0/Header";
import ShowcaseGallery from "../components/ShowcaseGallery";
import CliShowcase from "../components/CliShowcase";
import TrustCallout from "../components/TrustCallout";

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
          <Users className="w-4 h-4 text-violet-400" />
          <span className="text-2xl sm:text-3xl font-bold text-white">11+</span>
        </div>
        <span className="text-xs text-slate-500 uppercase tracking-widest">personas</span>
      </div>
    </div>
  );
}

// ─── Open Source Banner ─────────────────────────────────────────────────────

function OpenSourceBanner() {
  const [copied, setCopied] = useState(false);
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

        {/* Install CTA */}
        <div className="mt-8 flex justify-center">
          <div className="bg-black/30 rounded-lg px-4 py-3 font-mono text-sm flex items-center gap-3 border border-white/[0.06]">
            <Terminal className="w-4 h-4 text-teal-400 flex-shrink-0" />
            <code className="text-teal-300">npx workermill</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText("npx workermill");
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="text-slate-500 hover:text-white transition-colors flex-shrink-0"
            >
              {copied ? (
                <CheckCircle className="w-4 h-4 text-teal-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
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

// ─── Component ──────────────────────────────────────────────────────────────

export default function LandingV0() {
  const [copied, setCopied] = useState<string | null>(null);
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
          {/* Hero */}
          <section ref={topRef} className="relative pt-10 lg:pt-16 pb-16">
            <div className="container mx-auto px-6 lg:px-8">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-[1.1] text-center">
                Your backlog,{" "}
                <span className="bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent">
                  shipped overnight.
                </span>
              </h1>
              <p className="mt-6 text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto text-center leading-relaxed">
                Assign different models to different roles. Specialist personas — from backend developer to tech lead — plan, build, and review as a team.
              </p>

              {/* Install CTA */}
              <div className="mt-8 flex justify-center">
                <div className="bg-black/40 rounded-xl px-5 py-3.5 font-mono text-sm sm:text-base flex items-center gap-4 border border-white/10">
                  <Terminal className="w-4 h-4 text-teal-400 flex-shrink-0" />
                  <code className="text-teal-300">npx workermill</code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText("npx workermill");
                      setCopied("hero");
                      setTimeout(() => setCopied(null), 2000);
                    }}
                    className="text-slate-500 hover:text-white transition-colors flex-shrink-0"
                  >
                    {copied === "hero" ? (
                      <CheckCircle className="w-4 h-4 text-teal-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-slate-600">
                No account needed — just Node.js 20+
              </p>

              {/* Provider row */}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span>Works with</span>
                <span className="text-slate-400 font-medium">OpenAI</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-400 font-medium">Google</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-400 font-medium">Anthropic</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-400 font-medium">Ollama</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-400 font-medium">Groq</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-400 font-medium">Mistral</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-400 font-medium">DeepSeek</span>
                <span className="text-slate-600">·</span>
                <span>any OpenAI-compatible</span>
              </div>

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
                  <h3 className="text-lg font-semibold text-white mb-2">Pick a ticket</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    <code className="text-slate-400">/ship GH-42</code> fetches from GitHub Issues, Jira, or Linear. Or just describe what you want.
                  </p>
                </div>

                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 mb-4">
                    <GitBranch className="w-6 h-6 text-violet-400" />
                  </div>
                  <div className="text-xs font-bold text-violet-400 uppercase tracking-widest mb-2">Step 2</div>
                  <h3 className="text-lg font-semibold text-white mb-2">Planner decomposes</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    A dedicated planner model reads your codebase, scopes subtasks, and assigns specialists.
                  </p>
                </div>

                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 mb-4">
                    <Users className="w-6 h-6 text-blue-400" />
                  </div>
                  <div className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2">Step 3</div>
                  <h3 className="text-lg font-semibold text-white mb-2">Specialists build</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Backend, frontend, security, DevOps — each powered by your chosen model, scoped to their own files.
                  </p>
                </div>

                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-4">
                    <Zap className="w-6 h-6 text-amber-400" />
                  </div>
                  <div className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-2">Step 4</div>
                  <h3 className="text-lg font-semibold text-white mb-2">Tech lead reviews</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    A separate model reviews the diffs against your spec. You approve the PR and merge.
                  </p>
                </div>
              </div>

              {/* Differentiator cards removed — the CLI animation demonstrates these better */}
            </div>
          </section>

          {/* CLI terminal showcase — /ship GH-42 workflow animation */}
          <CliShowcase />

          {/* Why multi-expert? */}
          <section className="relative py-20">
            <div className="container mx-auto px-6 lg:px-8 max-w-5xl">
              <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-4">
                Why a team, not a{" "}
                <span className="bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent">
                  single agent?
                </span>
              </h2>
              <p className="text-slate-400 text-center max-w-2xl mx-auto mb-12">
                Single-agent tools use one model for everything. WorkerMill assigns the right model to each role — so you get better results at lower cost.
              </p>

              <div className="grid md:grid-cols-2 gap-8">
                {/* Single agent */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                  <div className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-4">Single agent</div>
                  <div className="space-y-3 font-mono text-sm">
                    <div className="flex items-center gap-3 text-slate-500">
                      <span className="w-20 text-right text-xs">plan</span>
                      <div className="flex-1 rounded bg-slate-800/50 px-3 py-1.5 text-slate-400">claude-opus-4-6</div>
                    </div>
                    <div className="flex items-center gap-3 text-slate-500">
                      <span className="w-20 text-right text-xs">code</span>
                      <div className="flex-1 rounded bg-slate-800/50 px-3 py-1.5 text-slate-400">claude-opus-4-6</div>
                    </div>
                    <div className="flex items-center gap-3 text-slate-500">
                      <span className="w-20 text-right text-xs">review</span>
                      <div className="flex-1 rounded bg-slate-800/50 px-3 py-1.5 text-slate-400">claude-opus-4-6</div>
                    </div>
                  </div>
                  <div className="mt-5 text-xs text-slate-500 space-y-1.5">
                    <p>Same model reviews its own code</p>
                    <p>Paying top-tier rates for every step</p>
                    <p>Blind spots stay blind</p>
                  </div>
                </div>

                {/* Multi-expert */}
                <div className="rounded-2xl border border-teal-500/20 bg-teal-500/[0.03] p-6">
                  <div className="text-sm font-semibold text-teal-400 uppercase tracking-widest mb-4">WorkerMill</div>
                  <div className="space-y-3 font-mono text-sm">
                    <div className="flex items-center gap-3 text-slate-400">
                      <span className="w-20 text-right text-xs text-cyan-400">plan</span>
                      <div className="flex-1 rounded bg-cyan-500/10 border border-cyan-500/20 px-3 py-1.5 text-cyan-300">gemini-3.1-flash-lite</div>
                    </div>
                    <div className="flex items-center gap-3 text-slate-400">
                      <span className="w-20 text-right text-xs text-teal-400">code</span>
                      <div className="flex-1 rounded bg-teal-500/10 border border-teal-500/20 px-3 py-1.5 text-teal-300">ollama/qwen3-coder:30b</div>
                    </div>
                    <div className="flex items-center gap-3 text-slate-400">
                      <span className="w-20 text-right text-xs text-purple-400">review</span>
                      <div className="flex-1 rounded bg-purple-500/10 border border-purple-500/20 px-3 py-1.5 text-purple-300">claude-opus-4-6</div>
                    </div>
                  </div>
                  <div className="mt-5 text-xs text-slate-400 space-y-1.5">
                    <p>A different model catches what the coder missed</p>
                    <p>Fast, cheap models where speed matters — powerful models where quality matters</p>
                    <p>Free local models for coding, paid models only for review</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Proof — live projects with real metrics */}
          <div id="showcase" ref={showcaseRef}>
            <ShowcaseGallery />
          </div>

          {/* Trust & Security */}
          <TrustCallout />

          {/* Open Source */}
          <OpenSourceBanner />

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
                href="https://jarodrosenthal.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl border border-white/10 bg-white/[0.03] text-slate-300 text-sm font-medium hover:bg-white/[0.06] hover:text-white transition-colors"
              >
                jarodrosenthal.com
              </a>
            </div>
          </section>

        </div>
      </div>
    </main>
  );
}
