import { Layers, ChevronDown, ChevronRight } from "lucide-react";
import type { PlanningTheme, PlannedStoryV2 } from "../../../types/planning-v2";
import { THEME_CATEGORY_LABELS, THEME_CATEGORY_COLORS } from "../../../types/planning-v2";
import { PERSONA_CONFIGS } from "../../../types/mission-control";

interface ThemeGroupHeaderProps {
  theme: PlanningTheme;
  stories: PlannedStoryV2[];
  isExpanded: boolean;
  onToggle: () => void;
  completedCount?: number;
}

/**
 * Header for a theme group in the stories list
 */
export function ThemeGroupHeader({
  theme,
  stories,
  isExpanded,
  onToggle,
  completedCount = 0,
}: ThemeGroupHeaderProps) {
  const categoryColor = THEME_CATEGORY_COLORS[theme.category];
  const categoryLabel = THEME_CATEGORY_LABELS[theme.category];

  // Get unique personas for this theme's stories
  const personas = [...new Set(stories.map((s) => s.persona))];

  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-3 py-2 bg-[var(--mc-bg-elevated)] border border-[var(--mc-border-subtle)] rounded-lg hover:bg-[var(--mc-bg-surface)] transition-colors"
    >
      {/* Expand/collapse icon */}
      <div className="text-[var(--mc-text-muted)]">
        {isExpanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </div>

      {/* Theme icon and ID */}
      <div
        className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[var(--mc-text-xs)] font-medium"
        style={{
          backgroundColor: `color-mix(in srgb, ${categoryColor} 20%, transparent)`,
          color: categoryColor,
        }}
      >
        <Layers className="w-3 h-3" />
        {theme.id}
      </div>

      {/* Theme name */}
      <div className="flex-1 text-left">
        <span className="text-[var(--mc-text-sm)] font-medium text-[var(--mc-text-primary)]">
          {theme.name}
        </span>
      </div>

      {/* Category label */}
      <span
        className="px-1.5 py-0.5 rounded text-[var(--mc-text-2xs)] uppercase tracking-wider"
        style={{ color: categoryColor }}
      >
        {categoryLabel}
      </span>

      {/* Persona avatars */}
      <div className="flex items-center -space-x-1">
        {personas.slice(0, 3).map((persona) => {
          const config = PERSONA_CONFIGS[persona];
          return (
            <span
              key={persona}
              className="w-5 h-5 flex items-center justify-center rounded-full bg-[var(--mc-bg-surface)] border border-[var(--mc-border-subtle)] text-[10px]"
              title={config?.label || persona}
            >
              {config?.emoji || "?"}
            </span>
          );
        })}
        {personas.length > 3 && (
          <span className="w-5 h-5 flex items-center justify-center rounded-full bg-[var(--mc-bg-surface)] border border-[var(--mc-border-subtle)] text-[var(--mc-text-2xs)] text-[var(--mc-text-muted)]">
            +{personas.length - 3}
          </span>
        )}
      </div>

      {/* Story count / progress */}
      <div className="flex items-center gap-1 text-[var(--mc-text-xs)]">
        <span className="text-[var(--mc-status-live)]">{completedCount}</span>
        <span className="text-[var(--mc-text-muted)]">/</span>
        <span className="text-[var(--mc-text-secondary)]">{stories.length}</span>
      </div>
    </button>
  );
}

/**
 * Compact theme pill for inline display
 */
export function ThemePill({ theme }: { theme: PlanningTheme }) {
  const categoryColor = THEME_CATEGORY_COLORS[theme.category];

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[var(--mc-text-2xs)]"
      style={{
        backgroundColor: `color-mix(in srgb, ${categoryColor} 15%, transparent)`,
        color: categoryColor,
      }}
      title={theme.description}
    >
      <Layers className="w-2.5 h-2.5" />
      {theme.id}: {theme.name}
    </span>
  );
}
