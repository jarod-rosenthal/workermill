import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../../components/ThemeToggle";
import Hero from "./Hero";
import HowItWorks from "./HowItWorks";
import Workers from "./Workers";
import Features from "./Features";
import { UseCases } from "./UseCases";
import { Metrics } from "./Metrics";
import { Integrations } from "./Integrations";
import { FAQ } from "./FAQ";
import { Demos } from "./Demos";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground relative">
      {/* Global background effects */}
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-to-b from-primary/5 via-transparent to-accent/5 pointer-events-none" />
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/30 glass-strong">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              WorkerMill
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <a href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              How it Works
            </a>
            <a href="#demos" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Demos
            </a>
            <a href="#workers" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Workers
            </a>
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Features
            </a>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              to="/login"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Login
            </Link>
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground text-sm font-semibold rounded-lg hover:shadow-lg hover:shadow-primary/25 transition-all duration-300"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main>
        <Hero />

        <div id="how-it-works">
          <HowItWorks />
        </div>

        <div id="demos">
          <Demos />
        </div>

        <div id="workers">
          <Workers />
        </div>

        <div id="features">
          <Features />
        </div>

        <div id="use-cases">
          <UseCases />
        </div>

        <div id="metrics">
          <Metrics />
        </div>

        <div id="integrations">
          <Integrations />
        </div>

        <div id="faq">
          <FAQ />
        </div>

        {/* Final CTA Section */}
        <section className="py-24 relative overflow-hidden">
          {/* Background effects */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/50 to-transparent" />
          <div className="orb orb-primary w-[600px] h-[600px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          <div className="orb orb-accent w-[400px] h-[400px] top-1/3 left-1/4" style={{ animationDelay: '-2s' }} />

          <div className="relative max-w-3xl mx-auto px-6 text-center">
            <h2 className="text-3xl lg:text-5xl font-bold mb-6">
              <span className="text-foreground">AI coding agents, </span>
              <span className="text-gradient-animated">
                orchestrated.
              </span>
            </h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              Multi-expert execution, quality gates, and real PR delivery. Open source and free to run locally.
            </p>
            <div className="mb-6">
              <code className="px-5 py-3 bg-muted/50 rounded-xl border border-border font-mono text-sm text-foreground inline-block">
                $ npx workermill
              </code>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/signup"
                className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5"
              >
                Get Started
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="https://github.com/jarod-rosenthal/workermill"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 text-foreground font-medium rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all duration-300"
              >
                View on GitHub
              </a>
            </div>
            <p className="mt-8 text-sm text-muted-foreground">
              Run locally with Ollama, or bring your own API keys. Cloud platform coming soon.
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-12">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                WorkerMill
              </span>
              <span className="text-sm text-muted-foreground">
                Open-source AI coding orchestration
              </span>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="mailto:jarod.rosenthal@workermill.com" className="hover:text-foreground transition-colors">
                Contact
              </a>
              <Link to="/privacy" className="hover:text-foreground transition-colors">
                Privacy
              </Link>
              <Link to="/terms" className="hover:text-foreground transition-colors">
                Terms
              </Link>
              <Link to="/security" className="hover:text-foreground transition-colors">
                Security
              </Link>
            </div>
            <p className="text-sm text-muted-foreground">
              2026 WorkerMill. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
