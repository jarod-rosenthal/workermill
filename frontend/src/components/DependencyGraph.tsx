import { useMemo } from "react";
import { X } from "lucide-react";

// Persona config for display
const PERSONA_CONFIGS: Record<string, { emoji: string; shortLabel: string }> = {
  frontend_developer: { emoji: "🎨", shortLabel: "Frontend" },
  backend_developer: { emoji: "⚙️", shortLabel: "Backend" },
  devops_engineer: { emoji: "🔧", shortLabel: "DevOps" },
  security_engineer: { emoji: "🔒", shortLabel: "Security" },
  qa_engineer: { emoji: "🧪", shortLabel: "QA" },
  tech_writer: { emoji: "📝", shortLabel: "Docs" },
  project_manager: { emoji: "📋", shortLabel: "PM" },
};

export type StoryStatus =
  | "planned"
  | "queued"
  | "claimed"
  | "environment_setup"
  | "executing"
  | "pr_created"
  | "review_requested"
  | "blocked"
  | "completed"
  | "deployed"
  | "failed"
  | "cancelled";

export interface PlanStory {
  index: number;
  title: string;
  persona: string;
  scope: string;
  acceptanceCriteria: string[];
  dependencies: number[];
  estimatedComplexity: "small" | "medium" | "large";
  status?: StoryStatus;
}

interface DependencyGraphProps {
  stories: PlanStory[];
  onClose: () => void;
}

// Get status icon/indicator
function getStatusIndicator(status: StoryStatus | undefined): string {
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
    case "planned":
    default:
      return "○";
  }
}

// Get status color class
function getStatusColorClass(status: StoryStatus | undefined): string {
  switch (status) {
    case "completed":
    case "deployed":
      return "text-green-500";
    case "executing":
    case "environment_setup":
      return "text-blue-500";
    case "claimed":
      return "text-cyan-500";
    case "blocked":
    case "failed":
      return "text-red-500";
    case "planned":
    default:
      return "text-muted-foreground";
  }
}

// Get border color class for node
function getNodeBorderClass(status: StoryStatus | undefined): string {
  switch (status) {
    case "completed":
    case "deployed":
      return "stroke-green-500";
    case "executing":
    case "environment_setup":
      return "stroke-blue-500";
    case "claimed":
      return "stroke-cyan-500";
    case "blocked":
    case "failed":
      return "stroke-red-500";
    case "planned":
    default:
      return "stroke-border";
  }
}

interface GraphNode {
  id: string;
  index: number;
  title: string;
  persona: string;
  personaEmoji: string;
  status: StoryStatus | undefined;
  dependencies: number[];
  level: number;
  position: number;
}

// Calculate graph layout levels
function calculateLayout(stories: PlanStory[]): GraphNode[] {
  const nodes: GraphNode[] = stories.map((story) => ({
    id: `story-${story.index}`,
    index: story.index,
    title: story.title.length > 25 ? story.title.substring(0, 25) + "..." : story.title,
    persona: PERSONA_CONFIGS[story.persona]?.shortLabel || story.persona,
    personaEmoji: PERSONA_CONFIGS[story.persona]?.emoji || "?",
    status: story.status,
    dependencies: story.dependencies || [],
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
      <div className="bg-background border border-border rounded-lg shadow-2xl max-w-[90vw] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
          <h2 className="text-lg font-semibold text-foreground">
            Dependency Graph
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Graph Content */}
        <div className="flex-1 overflow-auto p-4">
          {stories.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
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
                        className="stroke-border"
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
                    className="fill-border"
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
                        className={`fill-muted ${getNodeBorderClass(node.status)}`}
                        strokeWidth={2}
                      />

                      {/* Status indicator */}
                      <text
                        x={12}
                        y={24}
                        className={`text-sm font-bold ${getStatusColorClass(node.status)}`}
                        fill="currentColor"
                      >
                        {getStatusIndicator(node.status)}
                      </text>

                      {/* Story number */}
                      <text
                        x={28}
                        y={24}
                        className="text-xs font-mono fill-primary"
                      >
                        {node.index}.
                      </text>

                      {/* Title */}
                      <text
                        x={12}
                        y={44}
                        className="text-[11px] fill-muted-foreground"
                      >
                        {node.title}
                      </text>

                      {/* Persona */}
                      <text
                        x={nodeWidth - 12}
                        y={24}
                        textAnchor="end"
                        className="text-[11px] fill-muted-foreground"
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
        <div className="px-4 py-3 border-t border-border bg-muted/50">
          <div className="flex items-center gap-6 text-xs">
            <span className="text-muted-foreground">Legend:</span>
            <span className="flex items-center gap-1">
              <span className="text-green-500">✓</span>
              <span className="text-muted-foreground">Completed</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-blue-500">●</span>
              <span className="text-muted-foreground">Running</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-cyan-500">◐</span>
              <span className="text-muted-foreground">Claimed</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-muted-foreground">○</span>
              <span className="text-muted-foreground">Queued/Planned</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-red-500">⊘</span>
              <span className="text-muted-foreground">Blocked</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline dependency graph component (for embedding in task cards)
export function InlineDependencyGraph({ stories }: { stories: PlanStory[] }) {
  const nodes = useMemo(() => calculateLayout(stories), [stories]);

  // Simplified layout for inline display
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

  const maxNodesPerLevel = Math.max(
    ...Array.from(levelGroups.values()).map((g) => g.length),
    1
  );

  // Compact dimensions
  const nodeWidth = 120;
  const nodeHeight = 36;
  const levelGap = 60;
  const nodeGap = 12;

  const svgWidth = (maxLevel + 1) * (nodeWidth + levelGap) + 40;
  const svgHeight = maxNodesPerLevel * (nodeHeight + nodeGap) + 40;

  const getNodeX = (level: number) => 20 + level * (nodeWidth + levelGap);
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

  if (stories.length === 0) {
    return null;
  }

  return (
    <div className="bg-muted/30 rounded-lg p-3 overflow-x-auto">
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ minWidth: svgWidth, minHeight: svgHeight }}
      >
        {/* Edges */}
        <g className="edges">
          {edges.map((edge, idx) => {
            const fromX = getNodeX(edge.from.level) + nodeWidth;
            const fromY = getNodeY(edge.from.level, edge.from.position) + nodeHeight / 2;
            const toX = getNodeX(edge.to.level);
            const toY = getNodeY(edge.to.level, edge.to.position) + nodeHeight / 2;

            const midX = (fromX + toX) / 2;
            const path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;

            return (
              <path
                key={idx}
                d={path}
                fill="none"
                className="stroke-border"
                strokeWidth={1.5}
                markerEnd="url(***REMOVED***arrowhead-inline)"
              />
            );
          })}
        </g>

        <defs>
          <marker
            id="arrowhead-inline"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              className="fill-border"
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
                <rect
                  width={nodeWidth}
                  height={nodeHeight}
                  rx={4}
                  className={`fill-background ${getNodeBorderClass(node.status)}`}
                  strokeWidth={1.5}
                />

                {/* Status + Story number */}
                <text
                  x={8}
                  y={22}
                  className={`text-xs font-mono ${getStatusColorClass(node.status)}`}
                  fill="currentColor"
                >
                  {getStatusIndicator(node.status)} {node.index}.
                </text>

                {/* Persona emoji */}
                <text
                  x={nodeWidth - 8}
                  y={22}
                  textAnchor="end"
                  className="text-xs"
                >
                  {node.personaEmoji}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
