import { Star, AlertTriangle, CheckCircle, Info } from "lucide-react";
import type { PlanQualityScore } from "../../../types/planning-v2";
import {
  getQualityScoreColor,
  getQualityScoreLabel,
  MIN_PLAN_QUALITY_SCORE,
} from "../../../types/planning-v2";

interface PlanQualityBadgeProps {
  qualityScore: PlanQualityScore;
  showDetails?: boolean;
}

/**
 * Displays plan quality score with visual indicators
 */
export function PlanQualityBadge({
  qualityScore,
  showDetails = false,
}: PlanQualityBadgeProps) {
  const scoreColor = getQualityScoreColor(qualityScore.overall);
  const scoreLabel = getQualityScoreLabel(qualityScore.overall);
  const meetsThreshold = qualityScore.overall >= MIN_PLAN_QUALITY_SCORE;

  return (
    <div className="mc-quality-badge">
      {/* Score pill */}
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded text-[var(--mc-text-xs)] font-medium"
        style={{
          backgroundColor: `color-mix(in srgb, ${scoreColor} 20%, transparent)`,
          color: scoreColor,
        }}
      >
        <Star className="w-3 h-3" />
        <span>{qualityScore.overall.toFixed(1)}</span>
        <span className="opacity-70">{scoreLabel}</span>
        {meetsThreshold ? (
          <CheckCircle className="w-3 h-3 ml-0.5" />
        ) : (
          <AlertTriangle className="w-3 h-3 ml-0.5" />
        )}
      </div>

      {/* Detailed breakdown (optional) */}
      {showDetails && (
        <div className="mt-2 p-2 bg-[var(--mc-bg-elevated)] rounded border border-[var(--mc-border-subtle)]">
          <div className="grid grid-cols-3 gap-2 text-[var(--mc-text-xs)]">
            <ScoreDimension label="Completeness" value={qualityScore.completeness} />
            <ScoreDimension label="Ordering" value={qualityScore.ordering} />
            <ScoreDimension label="Balance" value={qualityScore.balance} />
          </div>

          {/* Blockers */}
          {qualityScore.blockers.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[var(--mc-border-subtle)]">
              <div className="flex items-center gap-1 text-[var(--mc-status-danger)] text-[var(--mc-text-xs)] font-medium mb-1">
                <AlertTriangle className="w-3 h-3" />
                Blockers
              </div>
              <ul className="text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] space-y-0.5">
                {qualityScore.blockers.map((blocker, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <span className="text-[var(--mc-status-danger)]">-</span>
                    {blocker}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggestions */}
          {qualityScore.suggestions.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[var(--mc-border-subtle)]">
              <div className="flex items-center gap-1 text-[var(--mc-status-info)] text-[var(--mc-text-xs)] font-medium mb-1">
                <Info className="w-3 h-3" />
                Suggestions
              </div>
              <ul className="text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] space-y-0.5">
                {qualityScore.suggestions.slice(0, 3).map((suggestion, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <span className="text-[var(--mc-status-info)]">-</span>
                    {suggestion}
                  </li>
                ))}
                {qualityScore.suggestions.length > 3 && (
                  <li className="text-[var(--mc-text-muted)] italic">
                    +{qualityScore.suggestions.length - 3} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Individual score dimension display
 */
function ScoreDimension({ label, value }: { label: string; value: number }) {
  const color = getQualityScoreColor(value);
  return (
    <div className="flex flex-col items-center">
      <span className="text-[var(--mc-text-muted)]">{label}</span>
      <span className="font-medium" style={{ color }}>
        {value.toFixed(1)}
      </span>
    </div>
  );
}

/**
 * Compact quality score indicator for use in headers
 */
export function QualityScoreIndicator({
  score,
  onClick,
}: {
  score: number;
  onClick?: () => void;
}) {
  const color = getQualityScoreColor(score);
  const meetsThreshold = score >= MIN_PLAN_QUALITY_SCORE;

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[var(--mc-text-xs)] font-medium transition-colors hover:bg-[var(--mc-bg-elevated)]"
      style={{ color }}
      title={`Plan Quality: ${score.toFixed(1)} - ${getQualityScoreLabel(score)}`}
    >
      <Star className="w-3 h-3" />
      {score.toFixed(1)}
      {meetsThreshold ? (
        <CheckCircle className="w-3 h-3" />
      ) : (
        <AlertTriangle className="w-3 h-3" />
      )}
    </button>
  );
}
