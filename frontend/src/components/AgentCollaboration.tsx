import { useState, useEffect, useRef } from "react";
import {
  MessageSquare,
  ShieldCheck,
  CheckCircle,
  GitPullRequest,
  MonitorPlay,
  Plug,
  MousePointerClick,
  Eye,
  FolderOpen,
  Brain,
  Zap,
} from "lucide-react";

function CalloutCard({
  persona,
  personaColor,
  icon: Icon,
  message,
  delay,
  visible,
}: {
  persona: string;
  personaColor: string;
  icon?: React.ComponentType<{ className?: string }>;
  message: string;
  delay: number;
  visible: boolean;
}) {
  const [show, setShow] = useState(false);
  const IconComponent = Icon || MessageSquare;

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(timer);
  }, [visible, delay]);

  return (
    <div
      className={`transition-all duration-700 ${
        show ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4"
      }`}
    >
      <div className="relative bg-slate-900/95 backdrop-blur-md border border-white/10 rounded-xl p-4 shadow-2xl max-w-sm">
        {/* Colored left accent bar */}
        <div
          className={`absolute left-0 top-3 bottom-3 w-1 rounded-full ${personaColor}`}
        />

        {/* Persona badge */}
        <div className="flex items-center gap-2 mb-2 ml-2">
          <IconComponent className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-semibold text-white">{persona}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full text-slate-300 border border-white/10">
            Agent
          </span>
        </div>

        {/* Message text */}
        <p className="text-sm text-slate-300 leading-relaxed ml-2">
          &ldquo;{message}&rdquo;
        </p>

        {/* Connector dot on left edge */}
        <div
          className={`absolute -left-2 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-slate-800 ${personaColor}`}
        />
      </div>
    </div>
  );
}

function ScreenshotFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative w-full">
      {/* Glow effect */}
      <div className="absolute -inset-1 bg-gradient-to-r from-teal-500/20 via-cyan-500/10 to-teal-500/20 rounded-2xl blur-xl opacity-60" />

      {/* Browser chrome */}
      <div className="relative bg-slate-950 rounded-xl border border-white/10 overflow-hidden shadow-2xl">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-3 bg-slate-900/80 border-b border-white/5">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <div className="flex-1 ml-3">
            <div className="bg-slate-800/80 rounded-md px-3 py-1 text-xs text-slate-400 max-w-xs mx-auto text-center">
              workermill.com/dashboard
            </div>
          </div>
        </div>

        {/* Screenshot */}
        <img src={src} alt={alt} className="w-full h-auto" loading="lazy" />
      </div>
    </div>
  );
}

function VSCodeFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative w-full">
      {/* Glow effect — blue-purple for VS Code */}
      <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 via-violet-500/10 to-blue-500/20 rounded-2xl blur-xl opacity-60" />

      {/* VS Code chrome */}
      <div className="relative bg-[#1e1e1e] rounded-xl border border-white/10 overflow-hidden shadow-2xl">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-[#323233] border-b border-white/5">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <div className="flex-1 ml-3 flex items-center justify-center gap-2">
            <svg
              className="w-4 h-4 text-blue-400"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M17.583 2.603L12.2 7.28l-4.041-3.06L2 7.38v9.24l6.16 3.16 4.04-3.06 5.382 4.677L24 18.24V5.76l-6.417-3.157zM8.16 15.38L4.4 13.2V10.8l3.76-2.18v6.76zm9.44-.54l-3.76 2.18V7.18l3.76-2.18v9.84z" />
            </svg>
            <span className="text-xs text-slate-400">
              WorkerMill — Visual Studio Code
            </span>
          </div>
        </div>

        {/* Screenshot */}
        <img src={src} alt={alt} className="w-full h-auto" loading="lazy" />
      </div>
    </div>
  );
}

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

export default function AgentCollaboration() {
  const section1 = useScrollVisible();
  const section2 = useScrollVisible();

  return (
    <>
      {/* ── Part 1: IDE-First Workflow ──────────────────────────────────── */}
      <section ref={section1.ref} className="py-24 relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-950/10 to-transparent" />

        <div className="relative container mx-auto px-6 lg:px-8">
          {/* Section header */}
          <div className="max-w-3xl mx-auto text-center mb-16">
            <p className="text-sm font-medium text-blue-400 mb-3 tracking-wide">
              STAY IN YOUR EDITOR
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-white mb-4 text-balance">
              Pick an issue. Click Run.{" "}
              <span className="bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-transparent">
                Keep coding.
              </span>
            </h2>
            <p className="text-lg text-slate-400 leading-relaxed">
              The VS Code extension is the fastest path from backlog to PR.
              Browse issues, kick off workers, and watch progress &mdash; all
              without leaving your editor.
            </p>
          </div>

          {/* VS Code screenshot */}
          <div className="max-w-5xl mx-auto mb-14">
            <VSCodeFrame
              src="/images/vscode-extension.png"
              alt="WorkerMill VS Code extension showing task sidebar, story progress, and live terminal logs inside the IDE"
            />
          </div>

          {/* Golden path steps */}
          <div className="max-w-4xl mx-auto grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                step: "1",
                icon: Plug,
                title: "Install & connect",
                description:
                  "One extension install, point it at your agent. Done in 30 seconds.",
              },
              {
                step: "2",
                icon: FolderOpen,
                title: "Browse your backlog",
                description:
                  "Issues from Jira, GitHub, or Linear appear in the sidebar tree.",
              },
              {
                step: "3",
                icon: MousePointerClick,
                title: "Click Run",
                description:
                  "Select an issue and hit Run. Workers plan, code, and test autonomously.",
              },
              {
                step: "4",
                icon: Eye,
                title: "Watch it build",
                description:
                  "Live terminal logs, story progress, and activity feed — right in VS Code.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className={`relative bg-slate-900/60 backdrop-blur-sm border border-white/5 rounded-xl p-5 transition-all duration-700 ${
                  section1.isVisible
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-6"
                }`}
                style={{
                  transitionDelay: `${parseInt(item.step) * 200}ms`,
                }}
              >
                {/* Step number */}
                <div className="absolute -top-3 -left-2 w-7 h-7 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center">
                  <span className="text-xs font-bold text-blue-400">
                    {item.step}
                  </span>
                </div>

                <item.icon className="w-5 h-5 text-blue-400 mb-3" />
                <p className="text-sm font-medium text-white mb-1">
                  {item.title}
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>

          {/* Feature pills */}
          <div className="mt-14 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8">
            {[
              {
                icon: MonitorPlay,
                title: "No context switching",
                description: "Everything happens inside VS Code",
              },
              {
                icon: Brain,
                title: "Full observability",
                description:
                  "Terminal logs, story progress, activity feed — live",
              },
              {
                icon: Zap,
                title: "Zero configuration",
                description: "Install the extension. That's the setup.",
              },
            ].map((pill) => (
              <div
                key={pill.title}
                className="flex items-center gap-3 bg-slate-900/60 backdrop-blur-sm border border-white/5 rounded-xl px-5 py-3"
              >
                <pill.icon className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">
                    {pill.title}
                  </p>
                  <p className="text-xs text-slate-400">{pill.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Part 2: Tech Lead Review ─────────────────────────────────────── */}
      <section ref={section2.ref} className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-900/50 to-transparent" />

        <div className="relative container mx-auto px-6 lg:px-8">
          {/* Section header */}
          <div className="max-w-3xl mx-auto text-center mb-16">
            <p className="text-sm font-medium text-teal-400 mb-3 tracking-wide">
              BUILT-IN QUALITY GATE
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-white mb-4 text-balance">
              Every PR reviewed by a{" "}
              <span className="bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent">
                virtual tech lead
              </span>{" "}
              before you see it
            </h2>
            <p className="text-lg text-slate-400 leading-relaxed">
              After execution completes, an AI tech lead reviews the code for
              correctness, patterns, and test coverage &mdash; iterating
              through multiple revision cycles before delivering the final PR.
            </p>
          </div>

          {/* Full screenshot + Callouts */}
          <div className="relative max-w-6xl mx-auto">
            <div className="flex flex-col xl:flex-row-reverse items-center gap-8 xl:gap-0">
              <div className="relative flex-shrink-0 w-full xl:w-[75%]">
                <ScreenshotFrame
                  src="/images/tech-lead-review.png"
                  alt="WorkerMill dashboard showing completed task with Tech Lead review approval and PR ready for merge"
                />
              </div>

              {/* Callout annotations (left side on desktop) */}
              <div className="xl:absolute xl:left-0 xl:top-1/2 xl:-translate-y-1/2 xl:-translate-x-[10%] flex flex-col gap-4 xl:gap-6 z-10">
                {/* Connector line (desktop only) */}
                <div className="hidden xl:block absolute -right-12 top-0 bottom-0 w-px">
                  <div className="h-full border-l-2 border-dashed border-teal-500/30" />
                </div>

                <CalloutCard
                  persona="Tech Lead"
                  personaColor="bg-violet-500"
                  icon={ShieldCheck}
                  message="Clean implementation. Test coverage is comprehensive. Tab titles are concise and consistent across all pages. Approving."
                  delay={400}
                  visible={section2.isVisible}
                />

                <CalloutCard
                  persona="Project Manager"
                  personaColor="bg-emerald-500"
                  icon={GitPullRequest}
                  message="PR created and ready for your review. All stories completed, tests passing."
                  delay={1200}
                  visible={section2.isVisible}
                />

                {/* "Complete" badge */}
                <div
                  className={`flex items-center gap-2 ml-4 transition-all duration-700 delay-[1800ms] ${
                    section2.isVisible
                      ? "opacity-100 translate-x-0"
                      : "opacity-0 translate-x-4"
                  }`}
                >
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm text-emerald-400 font-medium">
                    Production-ready code, not a prototype
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
