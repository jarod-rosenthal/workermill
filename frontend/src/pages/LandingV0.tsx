import { useRef, useEffect } from "react";
import { Home, Search, FolderOpen, Sparkles, Lock } from "lucide-react";
import { ImmersiveBackground } from "./Home/v0/ImmersiveBackground";
import { Header } from "./Home/v0/Header";
import { StatsSection } from "./Home/v0/StatsSection";
import { FeaturesGrid } from "./Home/v0/FeaturesGrid";
import HowItWorks from "./Home/HowItWorks";
import Workers from "./Home/Workers";
import Features from "./Home/Features";
import ShowcaseGallery from "../components/ShowcaseGallery";
import AgentCollaboration from "../components/AgentCollaboration";
import TeamCoordination from "../components/TeamCoordination";
import TrustCallout from "../components/TrustCallout";
import ExecutionShowcase from "../components/ExecutionShowcase";
import { Pricing } from "./Home/Pricing";

// ─── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({
  onNavigate,
}: {
  onNavigate: (target: string) => void;
}) {
  const items = [
    { icon: Home, label: "Home", action: () => onNavigate("top") },
    { icon: Search, label: "Search", action: () => onNavigate("showcase") },
    {
      icon: FolderOpen,
      label: "Projects",
      action: () => onNavigate("showcase"),
    },
    {
      icon: Sparkles,
      label: "Showcase",
      action: () => onNavigate("showcase"),
    },
  ];

  return (
    <aside className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-16 bg-slate-950/80 backdrop-blur-sm hidden lg:flex flex-col items-center py-4 gap-2 z-40">
      {items.map((item) => (
        <button
          key={item.label}
          onClick={item.action}
          title={item.label}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 transition-colors"
        >
          <item.icon className="w-5 h-5" />
        </button>
      ))}
    </aside>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function LandingV0() {
  // Refs for scroll targets
  const topRef = useRef<HTMLDivElement>(null);
  const showcaseRef = useRef<HTMLDivElement>(null);

  // Handle hash-based scrolling when navigating from other routes (e.g. /showcase/:id → /***REMOVED***showcase)
  useEffect(() => {
    const hash = window.location.hash.replace("***REMOVED***", "");
    if (hash) {
      const el = document.getElementById(hash);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 100);
      }
    }
  }, []);

  const handleSidebarNavigate = (target: string) => {
    const refMap: Record<string, React.RefObject<HTMLDivElement | null>> = {
      top: topRef,
      showcase: showcaseRef,
    };
    refMap[target]?.current?.scrollIntoView({ behavior: "smooth" });
  };

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
                WorkerMill is an autonomous AI engineering team. Features, tech debt, rewrites,
                greenfield — it executes your tickets end-to-end — coded, tested, reviewed, and validated through your pipeline.
              </p>
              {/* Trust badge */}
              <div className="mt-4 flex justify-center">
                <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20 tracking-wide backdrop-blur-sm">
                  <Lock className="w-3 h-3" />
                  Local-first — your code executes on your machine, not ours.
                </span>
              </div>
              {/* Platform compatibility */}
              <p className="mt-3 text-center text-sm text-slate-500">
                Runs on macOS, Linux, and Windows
              </p>
            </div>
          </section>

          {/* Execution lifecycle animation */}
          <ExecutionShowcase />

          {/* Showcase Section */}
          <div id="showcase" ref={showcaseRef}>
            <ShowcaseGallery />
          </div>

          <StatsSection />
          <FeaturesGrid />

          {/* Agent Collaboration Showcase */}
          <AgentCollaboration />

          {/* Team Coordination & Custom Experts */}
          <TeamCoordination />

          {/* How It Works Section */}
          <section>
            <HowItWorks />
            <Workers />
          </section>

          {/* Features Section */}
          <section>
            <Features />
          </section>

          {/* Trust & Security Callout */}
          <TrustCallout />

          {/* Pricing Section */}
          <section id="pricing">
            <Pricing />
          </section>
        </div>
      </div>
    </main>
  );
}
