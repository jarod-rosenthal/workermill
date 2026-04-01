import { useState, useEffect, useRef, useCallback } from "react";

interface Line {
  text: string;
  color: string;
  delay: number;
  typing?: boolean;
}

// The real WorkerMill flow: /review finds a security bug → creates GH issue → /ship fixes it → PR opened
const SCRIPT: Line[] = [
  // User kicks off a review
  { text: "> /review branch", color: "typing", delay: 0, typing: true },
  { text: "", color: "", delay: 400 },
  { text: " \ud83c\udfaf coordinator  Starting Tech Lead review...", color: "text-teal-400", delay: 600 },
  { text: " \ud83d\udc51 tech_lead  Reading src/routes/auth.js, src/middleware/auth.js...", color: "text-amber-400", delay: 800 },
  { text: " \ud83d\udc51 tech_lead  Reading src/controllers/authController.js...", color: "text-amber-400", delay: 600 },
  { text: " \ud83d\udc51 tech_lead  Reading src/routes/tasks.js, src/tests/auth.test.js...", color: "text-amber-400", delay: 600 },
  { text: "", color: "", delay: 400 },

  // Review finds a real issue
  { text: " \ud83d\udc51 tech_lead  CRITICAL: Missing auth middleware on /api/auth/profile", color: "text-red-400", delay: 800 },
  { text: " \ud83d\udc51 tech_lead  The /profile route is unprotected \u2014 anyone can access it without a token", color: "text-amber-400", delay: 600 },
  { text: " \ud83d\udc51 tech_lead  Score: 5/10 \u2014 revision needed", color: "text-amber-400", delay: 500 },
  { text: "", color: "", delay: 400 },

  // Auto-creates issue and kicks off /ship
  { text: " \ud83c\udfaf coordinator  Create a GitHub issue and fix it? (y/n) y", color: "text-teal-400", delay: 800 },
  { text: " \ud83c\udfaf coordinator  Created issue #6: Missing auth middleware on /profile", color: "text-teal-400", delay: 600 },
  { text: " \ud83c\udfaf coordinator  Fetched #6 \u2014 starting /ship...", color: "text-teal-400", delay: 500 },
  { text: "", color: "", delay: 400 },

  // Planner scopes the fix
  { text: " \ud83d\udca1 planner  Reading codebase + issue #6...", color: "text-violet-400", delay: 700 },
  { text: " \ud83d\udca1 planner  2 tasks:", color: "text-violet-400", delay: 400 },
  { text: "          [backend_developer] Apply auth middleware to /profile route", color: "text-slate-500", delay: 200 },
  { text: "          [qa_engineer] Add test: GET /profile without token returns 401", color: "text-slate-500", delay: 200 },
  { text: "", color: "", delay: 400 },

  // Backend dev fixes it
  { text: " \ud83d\udcbb backend_developer  Modified src/routes/auth.js", color: "text-blue-400", delay: 600 },
  { text: " \ud83d\udcbb backend_developer  Added: const auth = require('../middleware/auth')", color: "text-blue-400", delay: 400 },
  { text: " \ud83d\udcbb backend_developer  Quality gates... node -c \u2713", color: "check-line-blue", delay: 600 },
  { text: "", color: "", delay: 300 },

  // QA verifies
  { text: " \ud83e\uddea qa_engineer  Updated src/tests/auth.test.js", color: "text-cyan-400", delay: 500 },
  { text: " \ud83e\uddea qa_engineer  Added test: missing token \u2192 401 Unauthorized", color: "text-cyan-400", delay: 400 },
  { text: "", color: "", delay: 400 },

  // Tech lead approves
  { text: " \ud83d\udc51 tech_lead  Reviewing diffs...", color: "text-amber-400", delay: 800 },
  { text: " \ud83d\udc51 tech_lead  Auth middleware correctly applied. Tests cover all cases.", color: "text-amber-400", delay: 600 },
  { text: " \ud83d\udc51 tech_lead  Score: 9/10 \u2014 approved \u2713", color: "check-line-amber", delay: 600 },
  { text: "", color: "", delay: 400 },

  // Ship it
  { text: " \ud83e\udd16 system  Branch: GH-6/auth-middleware-fix (2 commits)", color: "text-teal-400", delay: 400 },
  { text: " \ud83e\udd16 system  \u2713 PR opened \u00b7 Comment posted to #6", color: "check-line-teal", delay: 600 },
  { text: "", color: "", delay: 300 },
  { text: " Shipped. 5 experts \u00b7 2 stories \u00b7 Review \u2192 Issue \u2192 Fix \u2192 PR", color: "text-emerald-400", delay: 800 },
];

const LOOP_PAUSE = 4000;
const CHAR_SPEED = 40;

/** Status bar matching the real CLI's 3-row layout */
function StatusBar({ progress }: { progress: number }) {
  // Animate tool counts based on progress
  const reads = progress > 0.3 ? Math.min(26, Math.round(progress * 30)) : 0;
  const bashes = progress > 0.5 ? Math.min(13, Math.round((progress - 0.3) * 20)) : 0;
  const edits = progress > 0.55 ? Math.min(3, Math.round((progress - 0.5) * 10)) : 0;
  const verifies = progress > 0.6 ? Math.min(5, Math.round((progress - 0.55) * 15)) : 0;
  const pct = Math.min(38, Math.round(progress * 40));
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  const cost = (progress * 0.09).toFixed(2);
  const mins = Math.max(1, Math.round(progress * 19));
  const branch = progress > 0.45 ? "GH-6/auth-middleware-fix" : "main";

  const tools = [
    reads > 0 && `\u2713 read file \u00d7${reads}`,
    bashes > 0 && `\u2713 bash \u00d7${bashes}`,
    verifies > 0 && `\u2713 verify \u00d7${verifies}`,
    edits > 0 && `\u2713 edit file \u00d7${edits}`,
  ].filter(Boolean);

  return (
    <div className="border-t border-white/[0.06] bg-[#111113] px-4 py-2 font-mono text-[11px] leading-[1.6]">
      {/* Row 1: model + context bar + branch + cost */}
      <div className="flex flex-wrap items-center gap-x-1 text-slate-400">
        <span className="text-white/80">[</span>
        <span className="text-teal-400 font-semibold">ollama/qwen3-coder:30b</span>
        <span className="text-slate-500">(64k context)</span>
        <span className="text-white/80">]</span>
        <span className="text-slate-600 ml-1">78t/s</span>
        <span className="ml-2">
          <span className={pct < 50 ? "text-emerald-500" : pct < 80 ? "text-yellow-500" : "text-red-500"}>
            {"\u2588".repeat(filled)}
          </span>
          <span className="text-slate-700">{"\u2591".repeat(empty)}</span>
        </span>
        <span className="ml-1">{pct}%</span>
        <span className="text-slate-700 mx-1">\u2502</span>
        <span className="text-slate-400">cli-demo</span>
        <span className="text-slate-500 ml-1">git:(</span>
        <span className="text-emerald-400">{branch}</span>
        <span className="text-slate-500">)</span>
        <span className="text-slate-700 mx-1">\u2502</span>
        <span>~${cost}</span>
        <span className="text-slate-700 mx-1">\u2502</span>
        <span className="text-slate-500">{mins}m</span>
      </div>
      {/* Row 2: tool counts */}
      <div className="flex flex-wrap items-center gap-x-1 text-slate-500">
        {tools.length > 0 ? tools.map((t, i) => (
          <span key={i} className="flex items-center">
            <span className="text-emerald-500/70">{t}</span>
            {i < tools.length - 1 && <span className="text-slate-700 mx-1">\u2502</span>}
          </span>
        )) : <span className="text-slate-600">no tool calls</span>}
      </div>
      {/* Row 3: permission mode + role models */}
      <div className="flex flex-wrap items-center gap-x-1">
        <span className="text-red-400 font-bold">{"\u25C8"} bypassPermissions</span>
        <span className="text-slate-600">(shift+tab)</span>
        <span className="text-slate-700 mx-1">\u2502</span>
        <span className="text-cyan-400 font-bold">plan</span>
        <span className="text-slate-500">:</span>
        <span className="text-cyan-400">google/gemini-3.1-pro</span>
        <span className="text-slate-700 mx-1">\u2502</span>
        <span className="text-purple-400 font-bold">review</span>
        <span className="text-slate-500">:</span>
        <span className="text-purple-300">anthropic/claude-opus-4-6</span>
      </div>
    </div>
  );
}

function renderLine(line: Line, isActive: boolean, typedChars: number) {
  if (!line.text) return <br />;

  if (line.typing) {
    const prompt = "> ";
    const command = line.text.slice(2);
    const visible = command.slice(0, Math.max(0, typedChars));
    return (
      <span>
        <span className="text-slate-500">{prompt}</span>
        <span className="text-white font-bold">{visible}</span>
        {isActive && <span className="animate-blink">|</span>}
      </span>
    );
  }

  // Lines with checkmarks get special coloring
  if (line.color.startsWith("check-line-")) {
    const baseColor = line.color.replace("check-line-", "");
    const colorClass = `text-${baseColor}-400`;
    const parts = line.text.split("\u2713");
    return (
      <span className={colorClass}>
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < parts.length - 1 && <span className="text-emerald-400">{"\u2713"}</span>}
          </span>
        ))}
      </span>
    );
  }

  return <span className={line.color}>{line.text}</span>;
}

export default function CliShowcase() {
  const [visibleLines, setVisibleLines] = useState(0);
  const [typedChars, setTypedChars] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (visibleLines >= SCRIPT.length) {
      timerRef.current = setTimeout(() => {
        setVisibleLines(0);
        setTypedChars(0);
        setIsTyping(false);
      }, LOOP_PAUSE);
      return clear;
    }

    const line = SCRIPT[visibleLines];

    if (line.typing && !isTyping) {
      timerRef.current = setTimeout(() => {
        setIsTyping(true);
        setTypedChars(0);
      }, line.delay || 100);
      return clear;
    }

    if (line.typing && isTyping) {
      const command = line.text.slice(2);
      if (typedChars < command.length) {
        timerRef.current = setTimeout(() => setTypedChars((c) => c + 1), CHAR_SPEED);
      } else {
        timerRef.current = setTimeout(() => {
          setIsTyping(false);
          setVisibleLines((v) => v + 1);
        }, 400);
      }
      return clear;
    }

    timerRef.current = setTimeout(() => setVisibleLines((v) => v + 1), line.delay || 100);
    return clear;
  }, [visibleLines, typedChars, isTyping, clear]);

  // Auto-scroll
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines, typedChars]);

  const activeIndex = visibleLines < SCRIPT.length ? visibleLines : -1;

  return (
    <section className="relative py-16">
      <style>{`
        @keyframes blink { 0%,100% { opacity: 1 } 50% { opacity: 0 } }
        .animate-blink { animation: blink 0.8s step-end infinite; }
      `}</style>
      <div className="container mx-auto px-6 lg:px-8 max-w-4xl">
        <div className="rounded-xl border border-white/10 bg-[#0d0d0f] shadow-2xl shadow-black/50 overflow-hidden ring-1 ring-white/[0.04]">
          {/* Title bar */}
          <div className="flex items-center gap-2 px-4 py-3 bg-[#1a1a1c] border-b border-white/[0.06]">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <span className="text-xs text-slate-500 ml-2 font-mono">workermill</span>
          </div>
          {/* Terminal content */}
          <div
            ref={containerRef}
            className="p-6 font-mono text-[13px] leading-relaxed min-h-[480px] max-h-[580px] overflow-y-auto"
          >
            {SCRIPT.slice(0, visibleLines + (isTyping ? 1 : 0)).map((line, i) => {
              const isActive =
                (i === activeIndex && !line.typing) ||
                (i === activeIndex && isTyping);
              return (
                <div key={i} className="min-h-[1.5em]">
                  {i < visibleLines
                    ? renderLine(line, false, line.typing ? line.text.length : 0)
                    : renderLine(line, isActive, typedChars)}
                </div>
              );
            })}
            {visibleLines === 0 && !isTyping && (
              <div className="min-h-[1.5em]">
                <span className="text-slate-500">&gt; </span>
                <span className="animate-blink text-white">|</span>
              </div>
            )}
          </div>
          {/* Status bar — matches the real CLI */}
          <StatusBar progress={visibleLines / SCRIPT.length} />
        </div>
      </div>
    </section>
  );
}
