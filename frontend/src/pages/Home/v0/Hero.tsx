import { Link } from "react-router-dom"
import { Button } from "../../../components/ui/button"
import { ArrowRight } from "lucide-react"
import { ControlCenter } from "./ControlCenter"

export function Hero() {
  return (
    <section className="relative pt-16 lg:pt-24 pb-12">
      <div className="container mx-auto px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 lg:gap-20 items-center">
          {/* Left content */}
          <div className="space-y-8">
            {/* Badge */}
            <div className="inline-flex">
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20 tracking-wide backdrop-blur-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                Local-first. Your code never leaves your machine.
              </span>
            </div>

            {/* Headline */}
            <div className="space-y-3">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-[1.1]">
                Ship production-grade software
              </h1>
              <p className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent leading-[1.1]">
                from a spec.
              </p>
            </div>

            {/* Description */}
            <p className="text-lg text-slate-400 max-w-xl leading-relaxed">
              Describe what you want to build. Our AI engineering team builds it with tests, CI/CD, and documentation. Run locally with your Anthropic account, or let us handle it.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link to="/build">
                <Button
                  size="lg"
                  className="bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 text-white rounded-lg px-6 h-12 text-sm font-medium shadow-lg shadow-teal-500/25 border-0"
                >
                  Start Building (free)
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a href="***REMOVED***showcase">
                <Button
                  variant="outline"
                  size="lg"
                  className="rounded-lg px-6 h-12 text-sm font-medium border-white/10 text-slate-300 hover:bg-white/5 hover:text-white bg-transparent"
                >
                  See Examples
                </Button>
              </a>
            </div>

            {/* VS Code extension link */}
            <a
              href="https://marketplace.visualstudio.com/items?itemName=workermill.workermill"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                <path d="M17.583 2.603l-5.402 4.884L5.23 2 3 3.86v16.28L5.23 22l6.95-5.49 5.403 4.888L21 19.622V4.378l-3.417-1.775zM5.23 16.378V7.622L9.09 12 5.23 16.378zm7.393.554L8.91 13.59 12.623 12l-3.714-1.592 3.714-3.34v8.864z" />
              </svg>
              Install for VS Code
            </a>

          </div>

          {/* Right content - Control Center */}
          <div className="flex justify-center lg:justify-end">
            <ControlCenter />
          </div>
        </div>
      </div>
    </section>
  )
}
