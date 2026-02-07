import { useState, useEffect } from "react";
import { ImmersiveBackground } from "./Home/v0/ImmersiveBackground";
import { Header } from "./Home/v0/Header";
import { StatsSection } from "./Home/v0/StatsSection";
import { FeaturesGrid } from "./Home/v0/FeaturesGrid";
import HowItWorks from "./Home/HowItWorks";
import Workers from "./Home/Workers";
import Features from "./Home/Features";
import ShowcaseGallery from "../components/ShowcaseGallery";
import CompetitiveComparison from "../components/CompetitiveComparison";
import { Pricing } from "./Home/Pricing";
import BuildTerminal, { type PlanPreview } from "../components/BuildTerminal";
import { Layers } from "lucide-react";

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

export default function LandingV0() {
  const [stackTemplates, setStackTemplates] = useState<StackTemplateOption[]>(
    [],
  );
  const [starterProjects, setStarterProjects] = useState<
    StarterProjectOption[]
  >([]);
  const [selectedStarter, setSelectedStarter] =
    useState<StarterProjectOption | null>(null);

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
  };

  // Show 5 starters (drop cli-tool, the smallest example)
  const displayStarters = starterProjects.filter((p) => p.id !== "cli-tool").slice(0, 5);

  return (
    <main className="min-h-screen relative overflow-hidden">
      <ImmersiveBackground />
      <div className="relative z-10">
        <Header />

        {/* Hero headline — spans full width, description drops down on the right */}
        <section className="relative pt-10 lg:pt-16 pb-16">
          <div className="container mx-auto px-6 lg:px-8">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-[1.1] text-center">
              Ship production-grade software{" "}
              <span className="bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent">
                from a spec.
              </span>
            </h1>
            <p className="mt-6 text-xl text-slate-400 max-w-3xl ml-auto text-right leading-relaxed">
              Describe what you want to build. Our AI engineering team builds
              it with tests, CI/CD, and documentation. Run locally with Claude
              Max, or let us handle it.
            </p>
          </div>
        </section>

        {/* Build terminal with example cards on sides */}
        <section className="relative pb-12">
          <div className="container mx-auto px-6 lg:px-8">
            <div className="grid lg:grid-cols-[1fr_3fr_1fr] gap-4 items-start">
              {/* Left side cards */}
              <div className="hidden lg:flex flex-col gap-4">
                {displayStarters.slice(0, 2).map((project) => (
                  <button
                    key={project.id}
                    onClick={() => handleStarterSelect(project)}
                    className={`text-left rounded-2xl overflow-hidden border transition-all group ${
                      selectedStarter?.id === project.id
                        ? "border-teal-500/50 bg-slate-900/80"
                        : "border-white/5 bg-slate-900/40 hover:border-teal-500/30 hover:bg-slate-900/60"
                    }`}
                  >
                    <div className="px-5 pt-5 pb-3">
                      <h3 className="text-sm font-semibold text-white group-hover:text-teal-400 transition-colors">
                        {project.title}
                      </h3>
                      <p className="text-xs text-slate-400 mt-1.5 leading-relaxed line-clamp-2">
                        {project.description}
                      </p>
                      <div className="mt-2">
                        <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border border-teal-500/30 text-teal-400 bg-teal-500/10">
                          {project.tags[0]}
                        </span>
                      </div>
                    </div>
                    <div className="px-5 py-3 border-t border-white/5">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Layers className="w-3 h-3" />
                          {project.estimatedStories} stories
                        </span>
                        <span>{project.complexity}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Center — Build terminal */}
              <BuildTerminal
                stackTemplates={stackTemplates}
                initialTitle={selectedStarter?.title ?? ""}
                initialDescription={selectedStarter?.description ?? ""}
                initialStack={selectedStarter?.stackTemplate ?? ""}
                cachedPlan={selectedStarter?.cachedPlan ?? null}
              />

              {/* Right side cards */}
              <div className="hidden lg:flex flex-col gap-4">
                {displayStarters.slice(2).map((project) => (
                  <button
                    key={project.id}
                    onClick={() => handleStarterSelect(project)}
                    className={`text-left rounded-2xl overflow-hidden border transition-all group ${
                      selectedStarter?.id === project.id
                        ? "border-teal-500/50 bg-slate-900/80"
                        : "border-white/5 bg-slate-900/40 hover:border-teal-500/30 hover:bg-slate-900/60"
                    }`}
                  >
                    <div className="px-5 pt-5 pb-3">
                      <h3 className="text-sm font-semibold text-white group-hover:text-teal-400 transition-colors">
                        {project.title}
                      </h3>
                      <p className="text-xs text-slate-400 mt-1.5 leading-relaxed line-clamp-2">
                        {project.description}
                      </p>
                      <div className="mt-2">
                        <span className="inline-block text-[10px] px-2 py-0.5 rounded-full border border-teal-500/30 text-teal-400 bg-teal-500/10">
                          {project.tags[0]}
                        </span>
                      </div>
                    </div>
                    <div className="px-5 py-3 border-t border-white/5">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Layers className="w-3 h-3" />
                          {project.estimatedStories} stories
                        </span>
                        <span>{project.complexity}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Showcase Section */}
        <ShowcaseGallery />

        <StatsSection />
        <FeaturesGrid />

        {/* Product Section */}
        <section id="product">
          <HowItWorks />
          <Workers />
        </section>

        {/* Solutions Section */}
        <section id="solutions">
          <Features />
        </section>

        {/* Competitive Comparison */}
        <CompetitiveComparison />

        {/* Pricing Section */}
        <section id="pricing">
          <Pricing />
        </section>
      </div>
    </main>
  );
}
