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

export default function Home() {
  const handleRequestAccess = () => {
    console.log("Request Early Access clicked");
    // TODO: Open waitlist modal or scroll to form
  };

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
            <a href="***REMOVED***how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              How it Works
            </a>
            <a href="***REMOVED***workers" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Workers
            </a>
            <a href="***REMOVED***features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
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
            <button
              onClick={handleRequestAccess}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground text-sm font-semibold rounded-lg hover:shadow-lg hover:shadow-primary/25 transition-all duration-300"
            >
              Request Access
            </button>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main>
        <Hero />

        <div id="how-it-works">
          <HowItWorks />
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
              <span className="text-foreground">Ready to scale your </span>
              <span className="text-gradient-animated">
                engineering team?
              </span>
            </h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              Join the private beta and start shipping code with AI workers today. Limited spots available.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={handleRequestAccess}
                className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-gradient-to-r from-primary to-cyan-400 text-primary-foreground font-semibold rounded-xl hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5"
              >
                Request Early Access
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              <button className="inline-flex items-center justify-center gap-2 px-8 py-4 text-foreground font-medium rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all duration-300">
                Schedule a Demo
              </button>
            </div>
            <p className="mt-8 text-sm text-muted-foreground">
              Free during early access. Ship faster with AI-powered automation.
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
                AI Engineering Teams
              </span>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="***REMOVED***" className="hover:text-foreground transition-colors">
                Privacy
              </a>
              <a href="***REMOVED***" className="hover:text-foreground transition-colors">
                Terms
              </a>
              <a href="***REMOVED***" className="hover:text-foreground transition-colors">
                Contact
              </a>
            </div>
            <p className="text-sm text-muted-foreground">
              2025 WorkerMill. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
