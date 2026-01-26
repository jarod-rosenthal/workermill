/**
 * ProgressRing - Circular progress indicator for Epic workflow stages
 *
 * Wraps around an icon to show completion percentage.
 * Designed for 40x40px icons with a thin ring around the edge.
 */

import type { ReactNode } from "react";

interface ProgressRingProps {
  /** Progress percentage (0-100) */
  progress: number;
  /** Size of the ring in pixels (should match icon container size) */
  size?: number;
  /** Ring stroke width */
  strokeWidth?: number;
  /** Whether the stage is currently active (enables animation) */
  isActive?: boolean;
  /** Color of the progress ring */
  color?: string;
  /** Background ring color */
  bgColor?: string;
  /** Child content (icon) to render in the center */
  children: ReactNode;
  /** Optional tooltip text */
  tooltip?: string;
  /** Additional CSS classes */
  className?: string;
}

export function ProgressRing({
  progress,
  size = 40,
  strokeWidth = 3,
  isActive = false,
  color = "var(--primary)",
  bgColor = "var(--border)",
  children,
  tooltip,
  className = "",
}: ProgressRingProps) {
  // Calculate SVG parameters
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  // Center point
  const center = size / 2;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      title={tooltip}
    >
      {/* SVG Ring */}
      <svg
        className="absolute inset-0"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* Background ring */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={bgColor}
          strokeWidth={strokeWidth}
          className="opacity-30"
        />

        {/* Progress ring */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`transition-all duration-500 ease-out ${
            isActive ? "animate-pulse" : ""
          }`}
          style={{
            // Start from top (rotate -90deg)
            transform: "rotate(-90deg)",
            transformOrigin: "center",
          }}
        />

        {/* Active indicator - subtle glow when active */}
        {isActive && progress > 0 && progress < 100 && (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth + 2}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="opacity-30 animate-pulse"
            style={{
              transform: "rotate(-90deg)",
              transformOrigin: "center",
              filter: "blur(2px)",
            }}
          />
        )}
      </svg>

      {/* Center content (icon) */}
      <div className="relative z-10 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

/**
 * EpicStageIcon - Workflow stage icon with optional progress ring for Epic tasks
 *
 * Shows a progress ring around the icon when in the "experts working" stage.
 */
interface EpicStageIconProps {
  /** Icon component to render */
  icon: ReactNode;
  /** Stage status */
  status: "done" | "active" | "pending" | "waiting";
  /** Whether this is the parallel execution stage */
  isParallelStage?: boolean;
  /** Progress percentage for parallel stage (0-100) */
  parallelProgress?: number;
  /** Stories completed / total for tooltip */
  storiesCompleted?: number;
  storiesTotal?: number;
  /** Size of the icon container */
  size?: number;
}

export function EpicStageIcon({
  icon,
  status,
  isParallelStage = false,
  parallelProgress = 0,
  storiesCompleted = 0,
  storiesTotal = 0,
  size = 40,
}: EpicStageIconProps) {
  const isDone = status === "done";
  const isActive = status === "active";
  const isWaiting = status === "waiting";

  // Build tooltip for parallel stage
  const tooltip = isParallelStage && storiesTotal > 0
    ? `${storiesCompleted}/${storiesTotal} stories complete`
    : undefined;

  // For parallel stage with progress, wrap in ProgressRing
  if (isParallelStage && isActive) {
    return (
      <ProgressRing
        progress={parallelProgress}
        size={size}
        isActive={true}
        tooltip={tooltip}
        color="hsl(var(--primary))"
        bgColor="hsl(var(--border))"
      >
        <div className={`w-6 h-6 flex items-center justify-center text-primary ${
          isActive ? "animate-pulse" : ""
        }`}>
          {icon}
        </div>
      </ProgressRing>
    );
  }

  // For completed parallel stage, show full ring
  if (isParallelStage && isDone) {
    return (
      <ProgressRing
        progress={100}
        size={size}
        isActive={false}
        tooltip={tooltip}
        color="hsl(var(--primary))"
        bgColor="hsl(var(--border))"
      >
        <div className="w-6 h-6 flex items-center justify-center text-primary-foreground">
          {icon}
        </div>
      </ProgressRing>
    );
  }

  // Standard icon rendering (no ring)
  return (
    <div
      className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
        isDone ? "bg-primary border-primary text-primary-foreground" :
        isActive ? "bg-primary/20 border-primary text-primary animate-pulse" :
        isWaiting ? "bg-yellow-500/20 border-yellow-500 text-yellow-500" :
        "bg-muted border-border text-muted-foreground"
      }`}
      title={tooltip}
    >
      <div className="w-5 h-5 flex items-center justify-center">
        {icon}
      </div>
    </div>
  );
}
