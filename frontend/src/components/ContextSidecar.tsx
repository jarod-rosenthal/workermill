/**
 * ContextSidecar Component
 *
 * Collapsible list of learned constraints for Pipeline V2.
 * Shows constraints that have been discovered during execution,
 * including when they were added. Constraints guide worker behavior
 * and help with recovery from failures.
 */

import { useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Clock,
  Lightbulb,
  Shield,
} from "lucide-react";

interface ContextSidecarProps {
  constraints: string[];
  className?: string;
}

/**
 * Categorize a constraint based on its content
 */
function categorizeConstraint(constraint: string): {
  category: "dependency" | "pattern" | "limitation" | "info";
  icon: React.ElementType;
  color: string;
} {
  const lower = constraint.toLowerCase();

  if (lower.includes("must") || lower.includes("require") || lower.includes("need")) {
    return { category: "dependency", icon: Shield, color: "text-blue-500" };
  }

  if (lower.includes("avoid") || lower.includes("don't") || lower.includes("cannot") || lower.includes("failed")) {
    return { category: "limitation", icon: AlertCircle, color: "text-red-500" };
  }

  if (lower.includes("use") || lower.includes("pattern") || lower.includes("follow")) {
    return { category: "pattern", icon: Lightbulb, color: "text-yellow-500" };
  }

  return { category: "info", icon: BookOpen, color: "text-gray-400" };
}

/**
 * Parse constraint to extract timestamp if present
 * Format: "[HH:MM:SS] constraint text" or just "constraint text"
 */
function parseConstraint(constraint: string): {
  text: string;
  timestamp?: string;
} {
  const timestampMatch = constraint.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*/);
  if (timestampMatch) {
    return {
      text: constraint.slice(timestampMatch[0].length),
      timestamp: timestampMatch[1],
    };
  }
  return { text: constraint };
}

/**
 * Single constraint item
 */
function ConstraintItem({ constraint, index }: { constraint: string; index: number }) {
  const { text, timestamp } = parseConstraint(constraint);
  const { icon: Icon, color } = categorizeConstraint(text);

  return (
    <div className="flex items-start gap-2 p-2 rounded border border-border/30 bg-muted/20 hover:bg-muted/40 transition-colors">
      <div className={`mt-0.5 ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-relaxed">{text}</p>
        {timestamp && (
          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>Added at {timestamp}</span>
          </div>
        )}
      </div>
      <span className="text-xs text-muted-foreground/50">***REMOVED***{index + 1}</span>
    </div>
  );
}

export function ContextSidecar({ constraints, className = "" }: ContextSidecarProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Don't render if no constraints
  if (constraints.length === 0) {
    return null;
  }

  return (
    <div className={`rounded-lg border border-amber-500/30 bg-amber-500/10 ${className}`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-amber-500/20 transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-medium text-amber-500">Learned Constraints</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
            {constraints.length}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-amber-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-amber-500" />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-3 pt-0 space-y-2">
          {/* Info text */}
          <p className="text-xs text-muted-foreground mb-3">
            Constraints discovered during execution that guide worker behavior.
          </p>

          {/* Constraints list */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {constraints.map((constraint, index) => (
              <ConstraintItem key={index} constraint={constraint} index={index} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact badge showing constraint count
 */
export function ContextSidecarBadge({ constraints }: { constraints: string[] }) {
  if (constraints.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30">
      <BookOpen className="w-3 h-3 text-amber-500" />
      <span className="text-xs font-medium text-amber-500">
        {constraints.length} constraint{constraints.length !== 1 ? "s" : ""}
      </span>
    </div>
  );
}
