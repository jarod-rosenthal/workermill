import { useState, useEffect, useRef, useCallback } from "react";

interface Line {
  text: string;
  color: string;
  delay: number;
  typing?: boolean;
}

const SCRIPT: Line[] = [
  { text: "> /ship GH-42", color: "typing", delay: 0, typing: true },
  { text: "", color: "", delay: 400 },
  { text: " system   Fetched GH-42: Add user authentication", color: "text-teal-400", delay: 600 },
  { text: "", color: "", delay: 300 },
  { text: " planner  Reading codebase... 38 files analyzed", color: "text-violet-400", delay: 800 },
  { text: " planner  3 tasks:", color: "text-violet-400", delay: 400 },
  { text: "          [backend_developer] Auth service: JWT tokens, login/signup endpoints", color: "text-slate-500", delay: 200 },
  { text: "          [backend_developer] Middleware: route protection, session handling", color: "text-slate-500", delay: 200 },
  { text: "          [frontend_developer] UI: signup form, login page, protected routes", color: "text-slate-500", delay: 200 },
  { text: "", color: "", delay: 500 },
  { text: " backend_developer  Created src/services/auth.ts", color: "text-blue-400", delay: 600 },
  { text: " backend_developer  Created src/middleware/requireAuth.ts", color: "text-blue-400", delay: 400 },
  { text: " backend_developer  Running quality gates... tsc \u2713 vitest \u2713", color: "check-line-blue", delay: 800 },
  { text: "", color: "", delay: 300 },
  { text: " frontend_developer  Created src/pages/Login.tsx", color: "text-cyan-400", delay: 500 },
  { text: " frontend_developer  Modified src/App.tsx", color: "text-cyan-400", delay: 400 },
  { text: " frontend_developer  Running quality gates... tsc \u2713 vitest \u2713", color: "check-line-cyan", delay: 600 },
  { text: "", color: "", delay: 500 },
  { text: " tech_lead  Reviewing diffs against original spec...", color: "text-amber-400", delay: 1000 },
  { text: " tech_lead  Score: 9/10 \u2014 approved \u2713", color: "check-line-amber", delay: 600 },
  { text: "", color: "", delay: 500 },
  { text: " system  Branch: workermill/user-auth (6 commits, 9 files, +680 lines)", color: "text-teal-400", delay: 400 },
  { text: " system  \u2713 PR opened \u00b7 Comment posted to GH-42", color: "check-line-teal", delay: 600 },
];

const LOOP_PAUSE = 3000;
const CHAR_SPEED = 50;

function renderLine(line: Line, isActive: boolean, typedChars: number) {
  if (!line.text) return <br />;

  if (line.typing) {
    const prompt = "> ";
    const command = line.text.slice(2);
    const visible = command.slice(0, Math.max(0, typedChars));
    return (
      <span>
        <span className="text-slate-500">{prompt}</span>
        <span className="text-white">{visible}</span>
        {isActive && <span className="animate-blink">|</span>}
      </span>
    );
  }

  // Lines with checkmarks get special coloring
  if (line.color.startsWith("check-line-")) {
    const base = line.color.replace("check-line-", "text-") + "-400";
    const parts = line.text.split("\u2713");
    return (
      <span className={base}>
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < parts.length - 1 && <span className="text-emerald-400">{"\u2713"}</span>}
          </span>
        ))}
        {isActive && <span className="animate-blink text-slate-400">|</span>}
      </span>
    );
  }

  return (
    <span className={line.color}>
      {line.text}
      {isActive && <span className="animate-blink text-slate-400">|</span>}
    </span>
  );
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
      // All lines shown -- pause then loop
      timerRef.current = setTimeout(() => {
        setVisibleLines(0);
        setTypedChars(0);
        setIsTyping(false);
      }, LOOP_PAUSE);
      return clear;
    }

    const line = SCRIPT[visibleLines];

    if (line.typing && !isTyping) {
      // Start typewriter after line delay
      timerRef.current = setTimeout(() => {
        setIsTyping(true);
        setTypedChars(0);
      }, line.delay || 100);
      return clear;
    }

    if (line.typing && isTyping) {
      const command = line.text.slice(2); // skip "> "
      if (typedChars < command.length) {
        timerRef.current = setTimeout(() => setTypedChars((c) => c + 1), CHAR_SPEED);
      } else {
        // Typing done -- brief pause then advance
        timerRef.current = setTimeout(() => {
          setIsTyping(false);
          setVisibleLines((v) => v + 1);
        }, 300);
      }
      return clear;
    }

    // Non-typing line: reveal after delay
    timerRef.current = setTimeout(() => setVisibleLines((v) => v + 1), line.delay || 100);
    return clear;
  }, [visibleLines, typedChars, isTyping, clear]);

  // Auto-scroll to bottom
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
            <span className="text-xs text-slate-500 ml-2">workermill</span>
          </div>
          {/* Terminal content */}
          <div
            ref={containerRef}
            className="p-6 font-mono text-sm leading-relaxed min-h-[420px] max-h-[520px] overflow-y-auto"
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
            {/* Blinking cursor when idle at start */}
            {visibleLines === 0 && !isTyping && (
              <div className="min-h-[1.5em]">
                <span className="text-slate-500">&gt; </span>
                <span className="animate-blink text-white">|</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
