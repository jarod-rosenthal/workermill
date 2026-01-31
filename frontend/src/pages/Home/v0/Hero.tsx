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
                Opus-quality output at Haiku prices
              </span>
            </div>

            {/* Headline */}
            <div className="space-y-3">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-[1.1]">
                Premium AI coding.
              </h1>
              <p className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent leading-[1.1]">
                Budget prices.
              </p>
            </div>

            {/* Description */}
            <p className="text-lg text-slate-400 max-w-xl leading-relaxed">
              {"WorkerMill's tight feedback loops make cheap models smart. Planning Agent validates before execution. Tech Lead reviews after. You get 90% of expensive model quality at 10% of the cost."}
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Button
                size="lg"
                className="bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 text-white rounded-lg px-6 h-12 text-sm font-medium shadow-lg shadow-teal-500/25 border-0"
              >
                Start Building
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="rounded-lg px-6 h-12 text-sm font-medium border-white/10 text-slate-300 hover:bg-white/5 hover:text-white bg-transparent"
              >
                Contact Sales
              </Button>
            </div>

            {/* Social proof micro */}
            <div className="flex items-center gap-4 pt-4">
              <div className="flex -space-x-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border-2 border-[***REMOVED***0d1424] flex items-center justify-center text-[10px] font-medium text-slate-400"
                  >
                    {String.fromCharCode(64 + i)}
                  </div>
                ))}
              </div>
              <div className="text-sm text-slate-500">
                <span className="font-medium text-slate-300">2,000+</span> engineers shipping with WorkerMill
              </div>
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
