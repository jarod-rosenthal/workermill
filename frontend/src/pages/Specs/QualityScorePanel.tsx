import { Lightbulb } from "lucide-react";
import type { Spec } from "../../lib/specs-api";

const DIMENSION_LABELS: Record<string, string> = {
  completeness: "Completeness",
  clarity: "Clarity",
  decomposability: "Decomposability",
  constraints: "Constraints",
  testability: "Testability",
};

const DIMENSION_ORDER = [
  "completeness",
  "clarity",
  "decomposability",
  "constraints",
  "testability",
] as const;

function scoreColor(score: number): string {
  if (score >= 85) return "text-green-500";
  if (score >= 70) return "text-blue-500";
  if (score >= 40) return "text-amber-500";
  return "text-red-500";
}

function barColor(score: number): string {
  if (score >= 85) return "bg-green-500";
  if (score >= 70) return "bg-blue-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

export default function QualityScorePanel({ spec }: { spec: Spec }) {
  const feedback = spec.qualityFeedback;
  const overall = spec.qualityScore;

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-6">
      {/* Overall score */}
      <div className="text-center">
        {overall == null ? (
          <div>
            <p className="text-4xl font-bold text-muted-foreground/40">--</p>
            <p className="text-sm text-muted-foreground mt-1">
              Not scored yet
            </p>
          </div>
        ) : (
          <div>
            <p className={`text-4xl font-bold ${scoreColor(overall)}`}>
              {overall}
            </p>
            <p className="text-sm text-muted-foreground mt-1">Quality Score</p>
          </div>
        )}
      </div>

      {/* Dimension bars */}
      {feedback && (
        <div className="space-y-4">
          {DIMENSION_ORDER.map((key) => {
            const dim = feedback.dimensions[key];
            if (!dim) return null;
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-foreground">
                    {DIMENSION_LABELS[key]}
                  </span>
                  <span
                    className={`text-sm font-semibold ${scoreColor(dim.score)}`}
                  >
                    {dim.score}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${barColor(dim.score)}`}
                    style={{ width: `${Math.min(100, Math.max(0, dim.score))}%` }}
                  />
                </div>
                {dim.feedback && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {dim.feedback}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Suggestions */}
      {feedback && feedback.suggestions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Suggestions
          </h3>
          <div className="space-y-2">
            {feedback.suggestions.map((suggestion, idx) => (
              <div
                key={idx}
                className="flex gap-2.5 p-3 rounded-lg bg-muted/30 border border-border/40"
              >
                <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-foreground/80">
                  <span className="text-muted-foreground font-medium mr-1">
                    {idx + 1}.
                  </span>
                  {suggestion}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
