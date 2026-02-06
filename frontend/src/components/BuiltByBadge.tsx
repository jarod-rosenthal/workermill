import { Zap } from "lucide-react";

interface BuiltByBadgeProps {
  size?: "sm" | "md";
}

export default function BuiltByBadge({ size = "sm" }: BuiltByBadgeProps) {
  const padding = size === "md" ? "px-4 py-2" : "px-3 py-1.5";
  const iconSize = size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";
  const textSize = size === "md" ? "text-sm" : "text-xs";

  return (
    <div
      className={`inline-flex items-center gap-1.5 ${padding} rounded-full bg-gradient-to-r from-primary/20 to-accent/20 border border-primary/30`}
    >
      <Zap className={`${iconSize} text-primary`} />
      <span
        className={`${textSize} font-semibold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent`}
      >
        Built by WorkerMill
      </span>
    </div>
  );
}
