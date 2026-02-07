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
              Describe what you want to build. Our AI engineering team builds it with tests, CI/CD, and documentation. Run locally with Claude Max, or let us handle it.
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
              <a href="#showcase">
                <Button
                  variant="outline"
                  size="lg"
                  className="rounded-lg px-6 h-12 text-sm font-medium border-white/10 text-slate-300 hover:bg-white/5 hover:text-white bg-transparent"
                >
                  See Examples
                </Button>
              </a>
            </div>

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
