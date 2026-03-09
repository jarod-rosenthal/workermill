import { useState } from "react";
import { ShieldCheck, ChevronDown } from "lucide-react";

const disclosureItems = [
  {
    title: "Task metadata",
    detail: "Status, timing, token usage",
  },
  {
    title: "Execution logs",
    detail: "Terminal output streamed to the dashboard",
  },
  {
    title: "Execution plans",
    detail: "Story descriptions, file paths, steps",
  },
  {
    title: "Code events",
    detail: "File edits for the Live Code Viewer",
  },
];

export default function TrustCallout() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="relative py-20 px-6 overflow-hidden">
      {/* Subtle emerald gradient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/20 via-transparent to-emerald-950/20" />

      <div className="relative max-w-3xl mx-auto">
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 backdrop-blur-sm p-8 sm:p-10">
          {/* Icon + Headline */}
          <div className="flex items-start gap-4 mb-4">
            <div className="flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10">
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white">
                Zero-trust AI engineering.
              </h3>
              <p className="mt-2 text-slate-400 leading-relaxed">
                WorkerMill executes on your infrastructure. The agent runs
                locally — your code never leaves your machine. For parallel
                workloads, you can optionally run in the cloud. Either way,
                you control where your code runs.
              </p>
            </div>
          </div>

          {/* Expandable disclosure */}
          <div className="mt-6">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
            >
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              />
              What the cloud dashboard receives
            </button>

            <div
              className={`grid transition-all duration-300 ease-in-out ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
            >
              <div className="overflow-hidden">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                  {disclosureItems.map((item) => (
                    <div
                      key={item.title}
                      className="rounded-lg bg-white/5 px-4 py-3"
                    >
                      <p className="text-sm font-medium text-slate-200">
                        {item.title}
                      </p>
                      <p className="text-sm text-slate-500">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <p className="mt-6 text-xs text-slate-500 leading-relaxed">
            Source code is never stored on our servers. All data is encrypted in
            transit (TLS) and ephemeral.
          </p>
        </div>
      </div>
    </section>
  );
}
