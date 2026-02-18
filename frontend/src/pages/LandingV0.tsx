import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Home, Search, FolderOpen, Sparkles } from "lucide-react";
import { ImmersiveBackground } from "./Home/v0/ImmersiveBackground";
import { Header } from "./Home/v0/Header";
import { StatsSection } from "./Home/v0/StatsSection";
import { FeaturesGrid } from "./Home/v0/FeaturesGrid";
import HowItWorks from "./Home/HowItWorks";
import Workers from "./Home/Workers";
import Features from "./Home/Features";
import ShowcaseGallery from "../components/ShowcaseGallery";
import CompetitiveComparison from "../components/CompetitiveComparison";
import AgentCollaboration from "../components/AgentCollaboration";
import { Pricing } from "./Home/Pricing";
import BuildTerminal, { type PlanPreview } from "../components/BuildTerminal";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface StarterProjectOption {
  id: string;
  title: string;
  description: string;
  stackTemplate: string;
  complexity: string;
  estimatedStories: number;
  tags: string[];
  cachedPlan?: PlanPreview | null;
}

interface StackTemplateOption {
  id: string;
  name: string;
  description: string;
  language: string;
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({
  onNavigate,
}: {
  onNavigate: (target: string) => void;
}) {
  const navigate = useNavigate();

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
  const [stackTemplates, setStackTemplates] = useState<StackTemplateOption[]>(
    [],
  );
  const [starterProjects, setStarterProjects] = useState<
    StarterProjectOption[]
  >([]);
  const [selectedStarter, setSelectedStarter] =
    useState<StarterProjectOption | null>(null);
  // Refs for scroll targets
  const topRef = useRef<HTMLDivElement>(null);
  const showcaseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadTemplates() {
      try {
        const res = await fetch(`${API_BASE}/api/build/templates`);
        if (res.ok) {
          const data = await res.json();
          setStackTemplates(data.stackTemplates || []);
          setStarterProjects(data.starterProjects || []);
        }
      } catch {
        // Templates are optional
      }
    }
    loadTemplates();
  }, []);

  const handleStarterSelect = (project: StarterProjectOption) => {
    setSelectedStarter(project);
    // Scroll to terminal so the user sees the plan replay
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSidebarNavigate = (target: string) => {
    const refMap: Record<string, React.RefObject<HTMLDivElement | null>> = {
      top: topRef,
      showcase: showcaseRef,
    };
    refMap[target]?.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Show all starters (drop cli-tool, the smallest example)
  const allStarters = starterProjects.filter((p) => p.id !== "cli-tool");
  const displayStarters = allStarters.slice(0, 5);

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
            </div>
          </section>

          {/* Build terminal — centered hero */}
          <section className="relative pb-12">
            <div className="container mx-auto px-6 lg:px-8 max-w-4xl">
              <BuildTerminal
                stackTemplates={stackTemplates}
                initialTitle={selectedStarter?.title ?? ""}
                initialDescription={selectedStarter?.description ?? ""}
                initialStack={selectedStarter?.stackTemplate ?? ""}
                cachedPlan={selectedStarter?.cachedPlan ?? null}
              />

              {/* Starter template pills */}
              {displayStarters.length > 0 && (
                <div className="mt-6 text-center">
                  <p className="text-sm text-slate-500 mb-3">
                    Or start with a template:
                  </p>
                  <div className="flex gap-3 flex-wrap justify-center">
                    {displayStarters.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => handleStarterSelect(project)}
                        className={`px-4 py-2 rounded-full text-sm transition-all ${
                          selectedStarter?.id === project.id
                            ? "bg-neutral-800 text-teal-300"
                            : "bg-neutral-900 text-slate-400 hover:bg-neutral-800 hover:text-slate-300"
                        }`}
                      >
                        {project.title}
                        <span className="ml-1.5 text-xs text-slate-500">
                          {project.estimatedStories} stories
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Showcase Section */}
          <div id="showcase" ref={showcaseRef}>
            <ShowcaseGallery />
          </div>

          <StatsSection />
          <FeaturesGrid />

          {/* Agent Collaboration Showcase */}
          <AgentCollaboration />

          {/* How It Works Section */}
          <section id="how-it-works">
            <HowItWorks />
            <Workers />
          </section>

          {/* Features Section */}
          <section>
            <Features />
          </section>

          {/* Competitive Comparison */}
          <CompetitiveComparison />

          {/* Pricing Section */}
          <section id="pricing">
            <Pricing />
          </section>
        </div>
      </div>
    </main>
  );
}
