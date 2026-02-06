import { CheckCircle, XCircle, Minus } from "lucide-react";

interface FeatureRow {
  feature: string;
  workermill: "yes" | "no" | "partial";
  devin: "yes" | "no" | "partial";
  copilot: "yes" | "no" | "partial";
  cursor: "yes" | "no" | "partial";
}

const features: FeatureRow[] = [
  {
    feature: "Runs on your machine",
    workermill: "yes",
    devin: "no",
    copilot: "no",
    cursor: "yes",
  },
  {
    feature: "Parallel AI experts",
    workermill: "yes",
    devin: "no",
    copilot: "no",
    cursor: "no",
  },
  {
    feature: "Multi-provider LLMs",
    workermill: "yes",
    devin: "no",
    copilot: "no",
    cursor: "no",
  },
  {
    feature: "Quality gates",
    workermill: "yes",
    devin: "no",
    copilot: "no",
    cursor: "no",
  },
  {
    feature: "Cost controls",
    workermill: "yes",
    devin: "partial",
    copilot: "no",
    cursor: "no",
  },
  {
    feature: "GitHub / GitLab / Bitbucket",
    workermill: "yes",
    devin: "partial",
    copilot: "no",
    cursor: "no",
  },
  {
    feature: "Real-time dashboard",
    workermill: "yes",
    devin: "yes",
    copilot: "no",
    cursor: "no",
  },
];

function StatusIcon({ status }: { status: "yes" | "no" | "partial" }) {
  if (status === "yes") {
    return <CheckCircle className="w-5 h-5 text-green-500" />;
  }
  if (status === "partial") {
    return <Minus className="w-5 h-5 text-yellow-500" />;
  }
  return <XCircle className="w-5 h-5 text-red-500/50" />;
}

const competitors = [
  { key: "workermill" as const, name: "WorkerMill", highlight: true },
  { key: "devin" as const, name: "Devin", highlight: false },
  { key: "copilot" as const, name: "Copilot Agents", highlight: false },
  { key: "cursor" as const, name: "Cursor", highlight: false },
];

export default function CompetitiveComparison() {
  return (
    <section className="py-24 relative">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/30 to-transparent" />

      <div className="relative max-w-4xl mx-auto px-6">
        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl lg:text-4xl font-bold mb-4">
            <span className="text-foreground">How we </span>
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              compare
            </span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            WorkerMill is the only platform that combines local execution, parallel experts, and multi-provider support.
          </p>
        </div>

        {/* Comparison table */}
        <div className="card-elevated border border-border/50 rounded-2xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-5 gap-4 px-6 py-4 border-b border-border/50 bg-muted/30">
            <div className="text-sm font-medium text-muted-foreground">Feature</div>
            {competitors.map((c) => (
              <div
                key={c.key}
                className={`text-sm font-semibold text-center ${
                  c.highlight ? "text-primary" : "text-foreground"
                }`}
              >
                {c.name}
              </div>
            ))}
          </div>

          {/* Table rows */}
          {features.map((row, i) => (
            <div
              key={row.feature}
              className={`grid grid-cols-5 gap-4 px-6 py-4 items-center ${
                i < features.length - 1 ? "border-b border-border/30" : ""
              }`}
            >
              <div className="text-sm text-foreground">{row.feature}</div>
              {competitors.map((c) => (
                <div key={c.key} className="flex justify-center">
                  <StatusIcon status={row[c.key]} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
