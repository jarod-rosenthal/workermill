import { useState, useEffect, useRef, useCallback } from "react";

interface Line {
  text: string;
  color: string;
  delay: number;
  typing?: boolean;
}

// Full demo: launch → chat → /ship GH-42 → plan → execute → review → PR
const SCRIPT: Line[] = [
  // Launch
  { text: "$ npx workermill", color: "text-slate-400", delay: 800 },
  { text: "", color: "", delay: 400 },
  { text: "  \u25c6 WorkerMill v0.15.89", color: "text-white font-bold", delay: 600 },
  { text: "", color: "", delay: 200 },
  { text: "  Use /model <provider>/<model> to switch models mid-session.", color: "text-slate-500", delay: 400 },
  { text: "  Type /help for all commands.", color: "text-slate-500", delay: 600 },
  { text: "", color: "", delay: 600 },

  // User asks about working tickets — natural lead-in to /ship
  { text: "> I have 12 open issues on GitHub. How do I get started?", color: "typing", delay: 0, typing: true },
  { text: "", color: "", delay: 400 },
  { text: "  Run /ship GH-42 with any issue number. I'll fetch the ticket,", color: "text-slate-300", delay: 600 },
  { text: "  plan the work, assign specialists, and open a PR when it's done.", color: "text-slate-300", delay: 500 },
  { text: "  Works with Jira and Linear too \u2014 /ship PROJ-123 or /ship TEAM-42.", color: "text-slate-300", delay: 500 },
  { text: "", color: "", delay: 800 },

  // User follows the advice
  { text: "> /ship GH-42", color: "typing", delay: 0, typing: true },
  { text: "", color: "", delay: 400 },
  { text: " \ud83e\udd16 system   Fetched GH-42: Add rate limiting and input validation", color: "text-teal-400", delay: 600 },
  { text: "", color: "", delay: 300 },
  { text: " \ud83d\udca1 planner  Reading codebase... 24 files analyzed", color: "text-violet-400", delay: 800 },
  { text: " \ud83d\udca1 planner  3 tasks:", color: "text-violet-400", delay: 400 },
  { text: "          [backend_developer] Add express-rate-limit to auth and API routes", color: "text-slate-500", delay: 200 },
  { text: "          [backend_developer] Add Zod validation to all request bodies", color: "text-slate-500", delay: 200 },
  { text: "          [qa_engineer] Add tests for rate limiting and validation errors", color: "text-slate-500", delay: 200 },
  { text: "", color: "", delay: 500 },

  // Specialists execute
  { text: " \ud83d\udcbb backend_developer  Modified src/routes/auth.js, src/routes/tasks.js", color: "text-blue-400", delay: 600 },
  { text: " \ud83d\udcbb backend_developer  Created src/middleware/validate.js", color: "text-blue-400", delay: 400 },
  { text: " \ud83d\udcbb backend_developer  Quality gates... node -c \u2713 npm test \u2713", color: "check-line-blue", delay: 700 },
  { text: "", color: "", delay: 300 },
  { text: " \ud83e\uddea qa_engineer  Created src/tests/rateLimit.test.js", color: "text-cyan-400", delay: 500 },
  { text: " \ud83e\uddea qa_engineer  Created src/tests/validation.test.js", color: "text-cyan-400", delay: 400 },
  { text: "", color: "", delay: 500 },

  // Tech lead reviews
  { text: " \ud83d\udc51 tech_lead  Reviewing diffs against issue GH-42...", color: "text-amber-400", delay: 900 },
  { text: " \ud83d\udc51 tech_lead  Rate limiting applied. Zod schemas validate all inputs.", color: "text-amber-400", delay: 600 },
  { text: " \ud83d\udc51 tech_lead  Score: 9/10 \u2014 approved \u2713", color: "check-line-amber", delay: 600 },
  { text: "", color: "", delay: 400 },

  // Ship it
  { text: " \ud83e\udd16 system  Branch: GH-42/rate-limiting-validation (3 commits, 7 files)", color: "text-teal-400", delay: 400 },
  { text: " \ud83e\udd16 system  \u2713 PR opened \u00b7 Comment posted to GH-42: completed", color: "check-line-teal", delay: 600 },
  { text: "", color: "", delay: 300 },
  { text: " Shipped. 4 experts \u00b7 3 tasks \u00b7 2m 48s", color: "text-emerald-400", delay: 800 },
];

const LOOP_PAUSE = 4000;
const CHAR_SPEED = 40;
const TERMINAL_HEIGHT = 620; // Fixed height — no growing

/** Status bar matching the real CLI's 3-row layout */
function StatusBar({ progress }: { progress: number }) {
  const reads = progress > 0.3 ? Math.min(18, Math.round(progress * 22)) : 0;
  const bashes = progress > 0.5 ? Math.min(8, Math.round((progress - 0.3) * 14)) : 0;
  const edits = progress > 0.55 ? Math.min(4, Math.round((progress - 0.5) * 12)) : 0;
  const verifies = progress > 0.6 ? Math.min(3, Math.round((progress - 0.55) * 10)) : 0;
  const pct = Math.min(32, Math.round(progress * 35));
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  const cost = (progress * 0.07).toFixed(2);
  const mins = Math.max(1, Math.round(progress * 3));
  const branch = progress > 0.5 ? "GH-42/rate-limiting-validation" : "main";

  const tools = [
    reads > 0 && `\u2713 read file \u00d7${reads}`,
    bashes > 0 && `\u2713 bash \u00d7${bashes}`,
    verifies > 0 && `\u2713 verify \u00d7${verifies}`,
    edits > 0 && `\u2713 edit file \u00d7${edits}`,
  ].filter(Boolean);

  return (
    <div className="border-t border-white/[0.06] bg-[#111113] px-4 py-2 font-mono text-[11px] leading-[1.6] flex-shrink-0">
      {/* Row 1 */}
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
        <span className="text-slate-600 mx-1">{"│"}</span>
        <span className="text-slate-400">cli-demo</span>
        <span className="text-slate-500 ml-1">git:(</span>
        <span className="text-emerald-400">{branch}</span>
        <span className="text-slate-500">)</span>
        <span className="text-slate-600 mx-1">{"│"}</span>
        <span>~${cost}</span>
        <span className="text-slate-600 mx-1">{"│"}</span>
        <span className="text-slate-500">{mins}m</span>
      </div>
      {/* Row 2 */}
      <div className="flex flex-wrap items-center gap-x-1 text-slate-500">
        {tools.length > 0 ? tools.map((t, i) => (
          <span key={i} className="flex items-center">
            <span className="text-emerald-500/70">{t}</span>
            {i < tools.length - 1 && <span className="text-slate-600 mx-1">{"│"}</span>}
          </span>
        )) : <span className="text-slate-600">no tool calls</span>}
      </div>
      {/* Row 3 */}
      <div className="flex flex-wrap items-center gap-x-1">
        <span className="text-red-400 font-bold">{"\u25C8"} bypassPermissions</span>
        <span className="text-slate-600">(shift+tab)</span>
        <span className="text-slate-600 mx-1">{"│"}</span>
        <span className="text-cyan-400 font-bold">plan</span>
        <span className="text-slate-500">:</span>
        <span className="text-cyan-400">google/gemini-3.1-pro</span>
        <span className="text-slate-600 ml-1">142t/s</span>
        <span className="text-slate-600 mx-1">{"│"}</span>
        <span className="text-purple-400 font-bold">review</span>
        <span className="text-slate-500">:</span>
        <span className="text-purple-300">anthropic/claude-opus-4-6</span>
        <span className="text-slate-600 ml-1">83t/s</span>
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

  // Auto-scroll within fixed container
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
      <div className="container mx-auto px-6 lg:px-8 max-w-5xl">
        <div
          className="rounded-xl border border-white/10 bg-[#0d0d0f] shadow-2xl shadow-black/50 overflow-hidden ring-1 ring-white/[0.04] flex flex-col"
          style={{ height: TERMINAL_HEIGHT }}
        >
          {/* Title bar */}
          <div className="flex items-center gap-2 px-4 py-3 bg-[#1a1a1c] border-b border-white/[0.06] flex-shrink-0">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <span className="text-xs text-slate-500 ml-2 font-mono">workermill</span>
          </div>
          {/* Terminal content — scrolls within fixed height */}
          <div
            ref={containerRef}
            className="p-6 font-mono text-[13px] leading-relaxed flex-1 overflow-y-auto"
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
          {/* Status bar — pinned to bottom */}
          <StatusBar progress={visibleLines / SCRIPT.length} />
        </div>
      </div>
    </section>
  );
}
