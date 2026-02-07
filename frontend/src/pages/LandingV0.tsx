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
import BuildTerminal, {
  PlanPreviewPanel,
  type PlanPreview,
} from "../components/BuildTerminal";
import { StarterTemplateRow } from "../components/StarterTemplates";

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
  const [generatedPlan, setGeneratedPlan] = useState<PlanPreview | null>(null);

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
    setGeneratedPlan(null);
  };

  // First 3 starters shown above build terminal, remaining shown as examples on right
  const topStarters = starterProjects.slice(0, 3);
  const exampleStarters = starterProjects.slice(3, 6);

  return (
    <main className="min-h-screen relative overflow-hidden">
      <ImmersiveBackground />
      <div className="relative z-10">
        <Header />

        {/* Hero headline — spans full width, description drops down on the right */}
        <section className="relative pt-10 lg:pt-16 pb-6">
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

        {/* Two-column: Build terminal LEFT, Examples RIGHT */}
        <section className="relative pb-12">
          <div className="container mx-auto px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">
              {/* LEFT column — Starter templates + Build terminal */}
              <div className="space-y-4">
                {topStarters.length > 0 && (
                  <StarterTemplateRow
                    projects={topStarters}
                    onSelect={handleStarterSelect}
                  />
                )}
                <BuildTerminal
                  stackTemplates={stackTemplates}
                  onPlanGenerated={(plan) => setGeneratedPlan(plan)}
                  initialTitle={selectedStarter?.title ?? ""}
                  initialDescription={selectedStarter?.description ?? ""}
                  initialStack={selectedStarter?.stackTemplate ?? ""}
                  cachedPlan={selectedStarter?.cachedPlan ?? null}
                />
              </div>

              {/* RIGHT column — Examples + Execution Plan */}
              <div className="space-y-4">
                {exampleStarters.length > 0 && (
                  <StarterTemplateRow
                    projects={exampleStarters}
                    onSelect={handleStarterSelect}
                  />
                )}

                {generatedPlan && <PlanPreviewPanel preview={generatedPlan} />}
              </div>
            </div>
          </div>
        </section>

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

        {/* Showcase Section */}
        <ShowcaseGallery />

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
