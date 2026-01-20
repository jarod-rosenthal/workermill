import { useRef, useEffect } from "react";
import { Check, X, AlertTriangle } from "lucide-react";
import type { ChildTask, ChildTaskStatus } from "../orchestration-store";
import { PERSONA_CONFIGS } from "../../../types/mission-control";

interface TerminalTabBarProps {
  children: ChildTask[];
  activeTabId: string | null;
  onTabSelect: (taskId: string) => void;
  unreadTasks: Set<string>;
  parentTaskId?: string;
}

// Get short persona code for tab
function getPersonaCode(persona: string): string {
  const config = PERSONA_CONFIGS[persona as keyof typeof PERSONA_CONFIGS];
  if (!config) return "??";

  // Use first 2 chars of shortLabel or create abbreviated code
  const label = config.shortLabel;
  if (label.length <= 2) return label.toUpperCase();

  // Extract initials or first letters
  const words = label.split(/[\s_-]/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return label.slice(0, 2).toUpperCase();
}

// Get status indicator for tab
function getStatusIndicator(status: ChildTaskStatus): {
  icon: "executing" | "completed" | "failed" | "blocked" | "pending";
  className: string;
} {
  switch (status) {
    case "executing":
    case "environment_setup":
      return { icon: "executing", className: "executing" };
    case "completed":
    case "deployed":
      return { icon: "completed", className: "completed" };
    case "failed":
    case "cancelled":
      return { icon: "failed", className: "failed" };
    case "blocked":
      return { icon: "blocked", className: "blocked" };
    default:
      return { icon: "pending", className: "pending" };
  }
}

/**
 * Horizontal tab bar for terminal panel
 * Shows tabs for each story with status indicators and unread badges
 */
export function TerminalTabBar({
  children,
  activeTabId,
  onTabSelect,
  unreadTasks,
}: TerminalTabBarProps) {
  const tabBarRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  // Scroll active tab into view when it changes
  useEffect(() => {
    if (activeTabRef.current && tabBarRef.current) {
      const tabBar = tabBarRef.current;
      const activeTab = activeTabRef.current;
      const tabBarRect = tabBar.getBoundingClientRect();
      const activeTabRect = activeTab.getBoundingClientRect();

      // Check if active tab is out of view
      if (activeTabRect.left < tabBarRect.left) {
        activeTab.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
      } else if (activeTabRect.right > tabBarRect.right) {
        activeTab.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "end" });
      }
    }
  }, [activeTabId]);

  if (children.length === 0) {
    return (
      <div className="mc-terminal-tab-bar">
        <span className="text-[var(--mc-text-muted)] text-[var(--mc-text-xs)] px-3">
          No stories yet
        </span>
      </div>
    );
  }

  return (
    <div ref={tabBarRef} className="mc-terminal-tab-bar">
      {children.map((story) => {
        const isActive = activeTabId === story.id;
        const isUnread = unreadTasks.has(story.id);
        const { icon, className: statusClass } = getStatusIndicator(story.status);
        const personaCode = getPersonaCode(story.workerPersona);
        const personaConfig = PERSONA_CONFIGS[story.workerPersona];
        const storyIndex = story.storyIndex ?? 1;

        return (
          <button
            key={story.id}
            ref={isActive ? activeTabRef : undefined}
            onClick={() => onTabSelect(story.id)}
            className={`mc-terminal-tab ${isActive ? "active" : ""} ${statusClass}`}
            title={`${story.summary} (${story.status})`}
          >
            {/* Status indicator */}
            <span className={`mc-terminal-tab-status ${statusClass}`}>
              {icon === "executing" && (
                <span className="mc-terminal-tab-pulse" />
              )}
              {icon === "completed" && <Check className="w-3 h-3" />}
              {icon === "failed" && <X className="w-3 h-3" />}
              {icon === "blocked" && <AlertTriangle className="w-3 h-3" />}
            </span>

            {/* Persona emoji + Story number */}
            <span className="mc-terminal-tab-label">
              {personaConfig?.emoji || "?"} {personaCode} S{storyIndex}
            </span>

            {/* Unread badge */}
            {isUnread && !isActive && (
              <span className="mc-terminal-tab-unread" />
            )}
          </button>
        );
      })}
    </div>
  );
}
