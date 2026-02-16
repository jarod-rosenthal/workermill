import { CheckCircle, XCircle, Minus, Crown } from "lucide-react";

interface FeatureRow {
  feature: string;
  description: string;
  workermill: "yes" | "no" | "partial";
  devin: "yes" | "no" | "partial";
  copilot: "yes" | "no" | "partial";
  cursor: "yes" | "no" | "partial";
  workermill_note?: string;
  devin_note?: string;
  copilot_note?: string;
  cursor_note?: string;
}

const features: FeatureRow[] = [
  {
    feature: "Free tier with local execution",
    description: "Get started at $0 — bring your own Claude Max and run workers locally",
    workermill: "yes",
    devin: "no",
    copilot: "no",
    cursor: "partial",
    workermill_note: "$0 forever",
    devin_note: "$500/seat/mo",
    cursor_note: "Free limited",
  },
  {
    feature: "Self-hosted / local-first",
    description: "Run workers on your own machine — code never leaves your environment",
    workermill: "yes",
    devin: "no",
    copilot: "no",
    cursor: "partial",
    workermill_note: "Full local mode",
    cursor_note: "IDE only",
  },
  {
    feature: "Cooperative multi-expert agents",
    description:
      "Planning agent decomposes tasks, parallel expert personas collaborate on one PR",
    workermill: "yes",
    devin: "no",
    copilot: "no",
    cursor: "no",
    workermill_note: "Unlimited custom personas",
  },
  {
    feature: "Multi-provider LLMs",
    description: "Choose between Claude, GPT, Gemini, Ollama, or bring your own key",
    workermill: "yes",
    devin: "no",
    copilot: "yes",
    cursor: "yes",
    devin_note: "Claude only",
  },
  {
    feature: "GitHub + GitLab + Bitbucket",
    description: "Native support for all major source control platforms",
    workermill: "yes",
    devin: "yes",
    copilot: "no",
    cursor: "no",
    copilot_note: "GitHub only",
    cursor_note: "GitHub only",
  },
  {
    feature: "Jira / Linear integration",
    description: "Tickets automatically trigger autonomous agent work via webhooks",
    workermill: "yes",
    devin: "yes",
    copilot: "no",
    cursor: "no",
  },
  {
    feature: "Real-time monitoring dashboard",
    description: "Live terminal output, cost tracking, and task orchestration visibility",
    workermill: "yes",
    devin: "yes",
    copilot: "partial",
    cursor: "partial",
    copilot_note: "Actions logs",
    cursor_note: "In-IDE status",
  },
  {
    feature: "Blocker escalation & recovery",
    description: "Auto-retry, error classification, human-in-the-loop retry/skip/abort",
    workermill: "yes",
    devin: "no",
    copilot: "partial",
    cursor: "no",
    copilot_note: "CI retry only",
  },
];

const competitors = [
  { key: "workermill" as const, name: "WorkerMill", highlight: true },
  { key: "devin" as const, name: "Devin", highlight: false },
  { key: "copilot" as const, name: "Copilot", highlight: false },
  { key: "cursor" as const, name: "Cursor", highlight: false },
];

function StatusBadge({
  status,
  note,
}: {
  status: "yes" | "no" | "partial";
  note?: string;
}) {
  if (status === "yes") {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="w-7 h-7 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
        </div>
        {note && (
          <span className="text-[10px] text-emerald-400/80">{note}</span>
        )}
      </div>
    );
  }
  if (status === "partial") {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="w-7 h-7 rounded-full bg-amber-500/15 flex items-center justify-center">
          <Minus className="w-4 h-4 text-amber-400" />
        </div>
        {note && (
          <span className="text-[10px] text-amber-400/80">{note}</span>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-7 h-7 rounded-full bg-slate-500/10 flex items-center justify-center">
        <XCircle className="w-4 h-4 text-slate-600" />
      </div>
      {note && <span className="text-[10px] text-slate-500">{note}</span>}
    </div>
  );
}

export default function CompetitiveComparison() {
  return (
    <section className="py-24 relative">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-900/30 to-transparent" />

      <div className="relative max-w-5xl mx-auto px-6">
        {/* Section header */}
        <div className="text-center mb-16">
          <p className="text-sm font-medium text-teal-400 mb-3 tracking-wide">
            COMPARISON
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold tracking-tight mb-4">
            <span className="text-white">How we </span>
            <span className="bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent">
              compare
            </span>
          </h2>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
            A fair look at where WorkerMill fits alongside leading AI coding
            tools.
          </p>
        </div>

        {/* Comparison table */}
        <div className="bg-slate-900/60 backdrop-blur-sm border border-white/5 rounded-2xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-5 gap-4 px-6 py-5 border-b border-white/5">
            <div className="text-sm font-medium text-slate-500">Feature</div>
            {competitors.map((c) => (
              <div key={c.key} className="flex flex-col items-center gap-1">
                {c.highlight && (
                  <Crown className="w-4 h-4 text-teal-400 mb-0.5" />
                )}
                <span
                  className={`text-sm font-semibold ${
                    c.highlight ? "text-teal-400" : "text-slate-300"
                  }`}
                >
                  {c.name}
                </span>
              </div>
            ))}
          </div>

          {/* Table rows */}
          {features.map((row, i) => (
            <div
              key={row.feature}
              className={`group grid grid-cols-5 gap-4 px-6 py-5 items-center transition-colors hover:bg-white/[0.02] ${
                i < features.length - 1 ? "border-b border-white/[0.03]" : ""
              }`}
            >
              {/* Feature name + description */}
              <div>
                <div className="text-sm font-medium text-white">
                  {row.feature}
                </div>
                <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {row.description}
                </div>
              </div>

              {/* Status cells */}
              {competitors.map((c) => (
                <div
                  key={c.key}
                  className={`flex justify-center ${
                    c.highlight
                      ? "relative before:absolute before:inset-x-0 before:-inset-y-5 before:bg-teal-500/[0.03] before:pointer-events-none"
                      : ""
                  }`}
                >
                  <StatusBadge
                    status={row[c.key]}
                    note={
                      row[
                        `${c.key}_note` as keyof FeatureRow
                      ] as string | undefined
                    }
                  />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-slate-600 mt-6">
          Based on publicly available product documentation as of February 2026.
          Competitors evolve fast — we update this regularly.
        </p>
      </div>
    </section>
  );
}
