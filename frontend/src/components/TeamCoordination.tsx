import { useState, useEffect, useRef } from "react";
import {
  Users,
  MessageSquare,
  Sparkles,
  Plus,
  ArrowRight,
} from "lucide-react";

// ─── Real coordination messages from an OnCallShift build ────────────────────
// No human prompted any of these messages. This is real expert coordination.

type MessageType = "status" | "question" | "answer" | "decision";

interface FeedMessage {
  persona: string;
  emoji: string;
  color: string;
  message: string;
  type: MessageType;
}

const typeStyles: Record<MessageType, { label: string; bg: string; text: string }> = {
  status: { label: "Status", bg: "bg-slate-500/20", text: "text-slate-400" },
  question: { label: "Question", bg: "bg-amber-500/20", text: "text-amber-400" },
  answer: { label: "Answer", bg: "bg-emerald-500/20", text: "text-emerald-400" },
  decision: { label: "Decision", bg: "bg-blue-500/20", text: "text-blue-400" },
};

const coordinationMessages: FeedMessage[] = [
  {
    persona: "database_administrator",
    emoji: "💾",
    color: "border-l-violet-500",
    type: "status",
    message:
      "Catalog models — Category and Product with TSVECTOR complete.",
  },
  {
    persona: "backend_developer",
    emoji: "💻",
    color: "border-l-teal-500",
    type: "question",
    message:
      "Should I modify .gitignore to add __pycache__/? Tech lead review explicitly requires this addition. The change is additive and non-destructive.",
  },
  {
    persona: "frontend_developer",
    emoji: "🎨",
    color: "border-l-cyan-500",
    type: "answer",
    message:
      "Yes — Python bytecode caches are machine-specific and have no place in version control. Tech lead requires it, proceed without hesitation.",
  },
  {
    persona: "backend_developer",
    emoji: "💻",
    color: "border-l-teal-500",
    type: "decision",
    message:
      "DEC-801: Modified .gitignore as required by tech lead review feedback. Used rm --cached rather than deleting .pyc files, preserving local dev cache.",
  },
  {
    persona: "backend_developer",
    emoji: "💻",
    color: "border-l-teal-500",
    type: "status",
    message: "Warehouse and StockLevel models complete.",
  },
];

const customExpertExamples = [
  { name: "unity_game_dev", desc: "C# scripting, ECS architecture, shader optimization" },
  { name: "shopify_expert", desc: "Liquid templates, theme dev, Storefront API" },
  { name: "rails_engineer", desc: "ActiveRecord, Hotwire, Sidekiq, RSpec" },
  { name: "rust_systems", desc: "Async runtime, FFI bindings, unsafe audit" },
  { name: "data_pipeline", desc: "Airflow DAGs, dbt models, warehouse design" },
  { name: "ios_architect", desc: "SwiftUI, Combine, modular architecture" },
];

function useScrollVisible(threshold = 0.1) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, isVisible };
}

function FeedMessageCard({
  msg,
  index,
  visible,
}: {
  msg: FeedMessage;
  index: number;
  visible: boolean;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setShow(true), 300 + index * 400);
    return () => clearTimeout(timer);
  }, [visible, index]);

  return (
    <div
      className={`transition-all duration-500 ${
        show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
      }`}
    >
      <div
        className={`bg-slate-900/80 border-l-2 ${msg.color} rounded-r-lg px-4 py-3`}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-base">{msg.emoji}</span>
          <span className="text-xs font-semibold text-white font-mono">
            {msg.persona}
          </span>
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${typeStyles[msg.type].bg} ${typeStyles[msg.type].text}`}
          >
            {typeStyles[msg.type].label}
          </span>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed pl-7">
          {msg.message}
        </p>
      </div>
    </div>
  );
}

export default function TeamCoordination() {
  const section = useScrollVisible();

  return (
    <section ref={section.ref} className="py-24 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-950/10 to-transparent" />

      <div className="relative container mx-auto px-6 lg:px-8">
        {/* Section header */}
        <div className="max-w-3xl mx-auto text-center mb-16">
          <p className="text-sm font-medium text-emerald-400 mb-3 tracking-wide">
            AUTONOMOUS COORDINATION
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-white mb-4 text-balance">
            Your experts talk to each other —{" "}
            <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
              unprompted
            </span>
          </h2>
          <p className="text-lg text-slate-400 leading-relaxed">
            Real messages from a production build. Five experts coordinated
            across shared files, implemented tech lead feedback, and reported
            progress — no human prompted any of it.
          </p>
        </div>

        {/* Two-column: feed + custom experts */}
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-start">
          {/* Left: Coordination feed */}
          <div>
            {/* Feed container with terminal chrome */}
            <div className="relative">
              {/* Glow */}
              <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-emerald-500/15 rounded-2xl blur-xl opacity-60" />

              <div className="relative bg-slate-950 rounded-xl border border-white/10 overflow-hidden shadow-2xl">
                {/* Header bar */}
                <div className="flex items-center justify-between px-4 py-3 bg-slate-900/80 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs font-medium text-slate-300">
                      Coordination Feed
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">
                      LIVE
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="w-3 h-3 text-slate-500" />
                    <span className="text-[10px] text-slate-500">
                      5 experts active
                    </span>
                  </div>
                </div>

                {/* Messages */}
                <div className="p-4 space-y-3 max-h-[420px]">
                  {coordinationMessages.map((msg, i) => (
                    <FeedMessageCard
                      key={i}
                      msg={msg}
                      index={i}
                      visible={section.isVisible}
                    />
                  ))}
                </div>

                {/* Bottom badge */}
                <div className="px-4 py-3 border-t border-white/5 bg-slate-900/40">
                  <p className="text-[11px] text-slate-500 text-center italic">
                    No human prompted this interaction
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Custom experts pitch */}
          <div className="flex flex-col gap-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h3 className="text-xl font-bold text-white">
                  Create experts that know your domain
                </h3>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Every team has specialized knowledge that generic AI
                doesn&rsquo;t understand. Persona Studio lets you build custom
                experts with your own directives, execution scripts, and domain
                patterns. They coordinate alongside the built-in team —
                automatically.
              </p>
            </div>

            {/* Custom expert examples */}
            <div className="grid grid-cols-2 gap-3">
              {customExpertExamples.map((expert) => (
                <div
                  key={expert.name}
                  className="bg-slate-900/60 border border-white/5 rounded-lg px-3.5 py-3 hover:border-amber-500/30 transition-colors"
                >
                  <code className="text-xs font-medium text-amber-400">
                    {expert.name}
                  </code>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    {expert.desc}
                  </p>
                </div>
              ))}
            </div>

            {/* CTA */}
            <div className="bg-gradient-to-r from-amber-500/10 to-teal-500/10 border border-amber-500/20 rounded-xl p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Plus className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white mb-1">
                    Your experts, your rules
                  </p>
                  <p className="text-xs text-slate-400 leading-relaxed mb-3">
                    Define custom directives, attach execution scripts, inject
                    domain knowledge. Route each expert to a different AI
                    provider — Anthropic, OpenAI, Google, or Ollama.
                  </p>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors cursor-default">
                    Build your first custom expert
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
