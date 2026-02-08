import { useState, useEffect, useRef } from "react";
import {
  MessageSquare,
  Sparkles,
  Brain,
  Zap,
  ShieldCheck,
  CheckCircle,
  GitPullRequest,
  ZoomIn,
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
  const [zoomVisible, setZoomVisible] = useState(false);

  useEffect(() => {
    if (!section1.isVisible) return;
    const timer = setTimeout(() => setZoomVisible(true), 400);
    return () => clearTimeout(timer);
  }, [section1.isVisible]);

  return (
    <>
      {/* ── Part 1: Agent Collaboration ──────────────────────────────────── */}
      <section ref={section1.ref} className="py-24 relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-teal-950/10 to-transparent" />

        <div className="relative container mx-auto px-6 lg:px-8">
          {/* Section header */}
          <div className="max-w-3xl mx-auto text-center mb-16">
            <p className="text-sm font-medium text-teal-400 mb-3 tracking-wide">
              REAL-TIME COLLABORATION
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-white mb-4 text-balance">
              Your AI team doesn&apos;t just work in parallel
              <span className="hidden sm:inline"> &mdash; </span>
              <br className="sm:hidden" />
              <span className="bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent">
                they communicate
              </span>
            </h2>
            <p className="text-lg text-slate-400 leading-relaxed">
              When a QA engineer has a question, it asks the frontend developer
              directly. Experts share context, resolve ambiguity, and coordinate
              autonomously &mdash; no human in the loop.
            </p>
          </div>

          {/* Full screenshot */}
          <div className="max-w-5xl mx-auto mb-12">
            <ScreenshotFrame
              src="/images/agent-collaboration.png"
              alt="WorkerMill dashboard showing QA Engineer and Frontend Developer collaborating in real-time on a task"
            />
          </div>

          {/* Zoomed screenshot + Callouts side by side */}
          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-8 items-start">
            {/* Real cropped screenshot of the coordination panel */}
            <div
              className={`transition-all duration-700 ${
                zoomVisible
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-6"
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <ZoomIn className="w-4 h-4 text-teal-400" />
                <span className="text-sm font-medium text-teal-400">
                  Coordination panel &mdash; agents communicate in real-time
                </span>
              </div>
              <div className="relative rounded-xl border border-teal-500/30 overflow-hidden shadow-2xl">
                <div className="absolute -inset-px bg-gradient-to-r from-teal-500/10 via-transparent to-teal-500/10 rounded-xl pointer-events-none z-10" />
                <img
                  src="/images/collaboration-zoom.png"
                  alt="Zoomed view of coordination panel showing QA Engineer asking a question and Backend Developer answering"
                  className="w-full h-auto"
                  loading="lazy"
                />
              </div>
            </div>

            {/* Callout annotations */}
            <div className="flex flex-col gap-5">
              <CalloutCard
                persona="QA Engineer"
                personaColor="bg-amber-500"
                message="What title format convention is usePageTitle hook using? I need to write E2E assertions that match the exact format."
                delay={600}
                visible={section1.isVisible}
              />

              <CalloutCard
                persona="Backend Developer"
                personaColor="bg-cyan-500"
                message="Let me look up the actual implementation to give you the exact format. The title is static, set in..."
                delay={1400}
                visible={section1.isVisible}
              />

              {/* "Autonomous" badge */}
              <div
                className={`flex items-center gap-2 ml-4 transition-all duration-700 delay-[2000ms] ${
                  section1.isVisible
                    ? "opacity-100 translate-x-0"
                    : "opacity-0 translate-x-4"
                }`}
              >
                <Sparkles className="w-4 h-4 text-teal-400" />
                <span className="text-sm text-teal-400 font-medium">
                  Fully autonomous &mdash; no human prompted this
                </span>
              </div>
            </div>
          </div>

          {/* Feature pills */}
          <div className="mt-16 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8">
            {[
              {
                icon: MessageSquare,
                title: "Autonomous coordination",
                description: "Agents talk to each other, no human needed",
              },
              {
                icon: Brain,
                title: "Context-aware",
                description: "Each expert sees the full project context",
              },
              {
                icon: Zap,
                title: "Zero prompt engineering",
                description:
                  "Just label a ticket, agents figure out the rest",
              },
            ].map((pill) => (
              <div
                key={pill.title}
                className="flex items-center gap-3 bg-slate-900/60 backdrop-blur-sm border border-white/5 rounded-xl px-5 py-3"
              >
                <pill.icon className="w-5 h-5 text-teal-400 flex-shrink-0" />
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
