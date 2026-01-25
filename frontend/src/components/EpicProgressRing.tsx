/**
 * EpicProgressRing - Circular progress indicator for Epic workflow
 * Shows completion percentage with visual ring
 */

interface EpicProgressRingProps {
  completed: number;
  total: number;
  size?: number;
  showLabel?: boolean;
}

export function EpicProgressRing({
  completed,
  total,
  size = 48,
  showLabel = true
}: EpicProgressRingProps) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  // Color based on progress
  const progressColor = percent === 100
    ? "text-green-500"
    : percent > 50
      ? "text-blue-500"
      : "text-primary";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        {/* Background ring */}
        <circle
          cx={size/2}
          cy={size/2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-muted/30"
          strokeWidth="4"
        />
        {/* Progress ring */}
        <circle
          cx={size/2}
          cy={size/2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className={`${progressColor} transition-all duration-500 ease-out`}
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      {showLabel && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold text-foreground">{percent}%</span>
        </div>
      )}
    </div>
  );
}

/**
 * Compact inline version
 */
export function EpicProgressCompact({ completed, total }: { completed: number; total: number }) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground font-medium">
        {percent}%
      </span>
    </div>
  );
}
