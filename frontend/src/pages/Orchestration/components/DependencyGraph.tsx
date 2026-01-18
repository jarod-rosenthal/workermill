import { useMemo } from "react";
import { X } from "lucide-react";
import type { ChildTask, ChildTaskStatus } from "../orchestration-store";
import { PERSONA_CONFIGS } from "../../../types/mission-control";

interface DependencyGraphProps {
  stories: ChildTask[];
  onClose: () => void;
}

// Get status icon/indicator
function getStatusIndicator(status: ChildTaskStatus): string {
  switch (status) {
    case "completed":
    case "deployed":
      return "✓";
    case "executing":
    case "environment_setup":
      return "●";
    case "claimed":
      return "◐";
    case "queued":
      return "○";
    case "blocked":
      return "⊘";
    case "failed":
      return "✗";
    default:
      return "○";
  }
}

// Get status color class
function getStatusColorClass(status: ChildTaskStatus): string {
  switch (status) {
    case "completed":
    case "deployed":
      return "text-[var(--mc-status-live)]";
    case "executing":
    case "environment_setup":
      return "text-[var(--mc-status-active)]";
    case "claimed":
      return "text-[var(--mc-status-info)]";
    case "blocked":
    case "failed":
      return "text-[var(--mc-status-danger)]";
    default:
      return "text-[var(--mc-text-muted)]";
  }
}

// Get border color class for node
function getNodeBorderClass(status: ChildTaskStatus): string {
  switch (status) {
    case "completed":
    case "deployed":
      return "border-[var(--mc-status-live)]";
    case "executing":
    case "environment_setup":
      return "border-[var(--mc-status-active)] animate-pulse";
    case "claimed":
      return "border-[var(--mc-status-info)]";
    case "blocked":
    case "failed":
      return "border-[var(--mc-status-danger)]";
    default:
      return "border-[var(--mc-border-default)]";
  }
}

interface GraphNode {
  id: string;
  index: number;
  title: string;
  persona: string;
  personaEmoji: string;
  status: ChildTaskStatus;
  dependencies: number[];
  level: number;
  position: number;
}

// Calculate graph layout levels
function calculateLayout(stories: ChildTask[]): GraphNode[] {
  const nodes: GraphNode[] = stories.map((story, idx) => ({
    id: story.id,
    index: story.storyIndex ?? idx + 1,
    title: story.summary.length > 25 ? story.summary.substring(0, 25) + "..." : story.summary,
    persona: PERSONA_CONFIGS[story.workerPersona]?.shortLabel || story.workerPersona,
    personaEmoji: PERSONA_CONFIGS[story.workerPersona]?.emoji || "?",
    status: story.status,
    dependencies: story.storyDependencies || [],
    level: 0,
    position: 0,
  }));

  // Calculate levels using topological sorting
  const nodeMap = new Map(nodes.map((n) => [n.index, n]));
  const visited = new Set<number>();
  const levels = new Map<number, number>();

  function getLevel(index: number): number {
    if (levels.has(index)) return levels.get(index)!;
    if (visited.has(index)) return 0;
    visited.add(index);

    const node = nodeMap.get(index);
    if (!node || node.dependencies.length === 0) {
      levels.set(index, 0);
      return 0;
    }

    const maxDepLevel = Math.max(
      ...node.dependencies.map((depIdx) => getLevel(depIdx))
    );
    const level = maxDepLevel + 1;
    levels.set(index, level);
    return level;
  }

  nodes.forEach((n) => getLevel(n.index));

  // Assign levels
  nodes.forEach((n) => {
    n.level = levels.get(n.index) || 0;
  });

  // Calculate positions within each level
  const levelGroups = new Map<number, GraphNode[]>();
  nodes.forEach((n) => {
    const group = levelGroups.get(n.level) || [];
    group.push(n);
    levelGroups.set(n.level, group);
  });

  levelGroups.forEach((group) => {
    group.forEach((node, idx) => {
      node.position = idx;
    });
  });

  return nodes;
}

export function DependencyGraph({ stories, onClose }: DependencyGraphProps) {
  const nodes = useMemo(() => calculateLayout(stories), [stories]);

  // Find max level for sizing
  const maxLevel = Math.max(...nodes.map((n) => n.level), 0);
  const levelGroups = useMemo(() => {
    const groups = new Map<number, GraphNode[]>();
    nodes.forEach((n) => {
      const group = groups.get(n.level) || [];
      group.push(n);
      groups.set(n.level, group);
    });
    return groups;
  }, [nodes]);

  // Calculate max nodes per level for height
  const maxNodesPerLevel = Math.max(
    ...Array.from(levelGroups.values()).map((g) => g.length),
    1
  );

  // Node dimensions
  const nodeWidth = 180;
  const nodeHeight = 60;
  const levelGap = 100;
  const nodeGap = 20;

  // Calculate SVG dimensions
  const svgWidth = (maxLevel + 1) * (nodeWidth + levelGap) + 100;
  const svgHeight = maxNodesPerLevel * (nodeHeight + nodeGap) + 100;

  // Get node position
  const getNodeX = (level: number) => 50 + level * (nodeWidth + levelGap);
  const getNodeY = (level: number, position: number) => {
    const nodesInLevel = levelGroups.get(level)?.length || 1;
    const totalHeight = nodesInLevel * nodeHeight + (nodesInLevel - 1) * nodeGap;
    const startY = (svgHeight - totalHeight) / 2;
    return startY + position * (nodeHeight + nodeGap);
  };

  // Create edges
  const edges: Array<{ from: GraphNode; to: GraphNode }> = [];
  nodes.forEach((node) => {
    node.dependencies.forEach((depIdx) => {
      const depNode = nodes.find((n) => n.index === depIdx);
      if (depNode) {
        edges.push({ from: depNode, to: node });
      }
    });
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[var(--mc-bg-surface)] border border-[var(--mc-border-default)] rounded-lg shadow-2xl max-w-[90vw] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--mc-border-subtle)] bg-[var(--mc-bg-elevated)]">
          <h2 className="text-[var(--mc-text-lg)] font-semibold text-[var(--mc-text-primary)]">
            Dependency Graph
          </h2>
          <button
            onClick={onClose}
            className="mc-btn mc-btn-ghost p-1"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Graph Content */}
        <div className="flex-1 overflow-auto p-4">
          {stories.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-[var(--mc-text-muted)]">
              No stories to display
            </div>
          ) : (
            <svg
              width={svgWidth}
              height={svgHeight}
              className="mx-auto"
              style={{ minWidth: svgWidth, minHeight: svgHeight }}
            >
              {/* Edges */}
              <g className="edges">
                {edges.map((edge, idx) => {
                  const fromX = getNodeX(edge.from.level) + nodeWidth;
                  const fromY = getNodeY(edge.from.level, edge.from.position) + nodeHeight / 2;
                  const toX = getNodeX(edge.to.level);
                  const toY = getNodeY(edge.to.level, edge.to.position) + nodeHeight / 2;

                  // Create curved path
                  const midX = (fromX + toX) / 2;
                  const path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;

                  return (
                    <g key={idx}>
                      <path
                        d={path}
                        fill="none"
                        stroke="var(--mc-border-default)"
                        strokeWidth={2}
                        markerEnd="url(***REMOVED***arrowhead)"
                      />
                    </g>
                  );
                })}
              </g>

              {/* Arrow marker definition */}
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 10 3.5, 0 7"
                    fill="var(--mc-border-default)"
                  />
                </marker>
              </defs>

              {/* Nodes */}
              <g className="nodes">
                {nodes.map((node) => {
                  const x = getNodeX(node.level);
                  const y = getNodeY(node.level, node.position);

                  return (
                    <g key={node.id} transform={`translate(${x}, ${y})`}>
                      {/* Node background */}
                      <rect
                        width={nodeWidth}
                        height={nodeHeight}
                        rx={6}
                        fill="var(--mc-bg-elevated)"
                        stroke="var(--mc-border-default)"
                        strokeWidth={2}
                        className={getNodeBorderClass(node.status)}
                      />

                      {/* Status indicator */}
                      <text
                        x={12}
                        y={24}
                        className={`text-[14px] font-bold ${getStatusColorClass(node.status)}`}
                        fill="currentColor"
                      >
                        {getStatusIndicator(node.status)}
                      </text>

                      {/* Story number */}
                      <text
                        x={28}
                        y={24}
                        className="text-[12px] font-mono"
                        fill="var(--mc-status-active)"
                      >
                        {node.index}.
                      </text>

                      {/* Title */}
                      <text
                        x={12}
                        y={44}
                        className="text-[11px]"
                        fill="var(--mc-text-secondary)"
                      >
                        {node.title}
                      </text>

                      {/* Persona */}
                      <text
                        x={nodeWidth - 12}
                        y={24}
                        textAnchor="end"
                        className="text-[11px]"
                        fill="var(--mc-text-muted)"
                      >
                        {node.personaEmoji} {node.persona}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>

        {/* Legend */}
        <div className="px-4 py-3 border-t border-[var(--mc-border-subtle)] bg-[var(--mc-bg-elevated)]">
          <div className="flex items-center gap-6 text-[var(--mc-text-xs)]">
            <span className="text-[var(--mc-text-muted)]">Legend:</span>
            <span className="flex items-center gap-1">
              <span className="text-[var(--mc-status-live)]">✓</span>
              <span className="text-[var(--mc-text-secondary)]">Completed</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-[var(--mc-status-active)]">●</span>
              <span className="text-[var(--mc-text-secondary)]">Running</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-[var(--mc-status-info)]">◐</span>
              <span className="text-[var(--mc-text-secondary)]">Claimed</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-[var(--mc-text-muted)]">○</span>
              <span className="text-[var(--mc-text-secondary)]">Queued</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-[var(--mc-status-danger)]">⊘</span>
              <span className="text-[var(--mc-text-secondary)]">Blocked</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
