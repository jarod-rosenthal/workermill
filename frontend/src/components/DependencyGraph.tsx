import { useMemo } from "react";
import { X } from "lucide-react";

export type PersonaMap = Record<string, { emoji: string; shortLabel: string }>;

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
  epicTitle?: string;
  personaMap?: PersonaMap;
}

// Check if status is "active" (running/executing)
function isActiveStatus(status: StoryStatus | undefined): boolean {
  return status === "executing" || status === "environment_setup" || status === "claimed";
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
    case "cancelled":
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

// Get fill color for node background based on status
function getNodeFillClass(status: StoryStatus | undefined): string {
  switch (status) {
    case "completed":
    case "deployed":
      return "fill-green-500/10";
    case "executing":
    case "environment_setup":
      return "fill-blue-500/10";
    case "claimed":
      return "fill-cyan-500/10";
    case "blocked":
    case "failed":
      return "fill-red-500/10";
    case "planned":
    default:
      return "fill-muted";
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
function calculateLayout(stories: PlanStory[], personaMap?: PersonaMap): GraphNode[] {
  const nodes: GraphNode[] = stories.map((story) => ({
    id: `story-${story.index}`,
    index: story.index,
    title: story.title.length > 22 ? story.title.substring(0, 22) + "..." : story.title,
    persona: personaMap?.[story.persona]?.shortLabel || story.persona,
    personaEmoji: personaMap?.[story.persona]?.emoji || "?",
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

  // Assign levels (shift by 1 to make room for START node)
  nodes.forEach((n) => {
    n.level = (levels.get(n.index) || 0) + 1;
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

export function DependencyGraph({
  stories,
  onClose,
  epicTitle,
  personaMap,
}: DependencyGraphProps) {
  const nodes = useMemo(() => calculateLayout(stories, personaMap), [stories, personaMap]);

  // Find max level for sizing (including START node at level 0)
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

  // Get root nodes (no dependencies) - these connect directly to START
  const rootNodes = useMemo(
    () => nodes.filter((n) => n.dependencies.length === 0),
    [nodes]
  );

  // Calculate max nodes per level for height
  const maxNodesPerLevel = Math.max(
    ...Array.from(levelGroups.values()).map((g) => g.length),
    1
  );

  // Node dimensions
  const nodeWidth = 200;
  const nodeHeight = 56;
  const levelGap = 80;
  const nodeGap = 16;
  const startNodeWidth = 100;
  const startNodeHeight = 40;

  // Calculate SVG dimensions
  const svgWidth = (maxLevel + 1) * (nodeWidth + levelGap) + startNodeWidth + 150;
  const svgHeight = Math.max(maxNodesPerLevel * (nodeHeight + nodeGap) + 80, 200);

  // Get node position (level 0 is START, actual nodes start at level 1)
  const getNodeX = (level: number) => startNodeWidth + 60 + level * (nodeWidth + levelGap);
  const getNodeY = (level: number, position: number) => {
    const nodesInLevel = levelGroups.get(level)?.length || 1;
    const totalHeight = nodesInLevel * nodeHeight + (nodesInLevel - 1) * nodeGap;
    const startY = (svgHeight - totalHeight) / 2;
    return startY + position * (nodeHeight + nodeGap);
  };

  // START node position
  const startX = 30;
  const startY = svgHeight / 2 - startNodeHeight / 2;

  // Create edges between task nodes
  const taskEdges: Array<{ from: GraphNode; to: GraphNode }> = [];
  nodes.forEach((node) => {
    node.dependencies.forEach((depIdx) => {
      const depNode = nodes.find((n) => n.index === depIdx);
      if (depNode) {
        taskEdges.push({ from: depNode, to: node });
      }
    });
  });

  // Check if there are parallel tasks at the first level
  const hasParallelRoots = rootNodes.length > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-lg shadow-2xl max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Workflow Execution Graph
            </h2>
            {epicTitle && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {epicTitle}
              </p>
            )}
          </div>
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
              {/* Definitions for markers and gradients */}
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1" />
                </marker>
                <marker
                  id="arrowhead-parallel"
                  markerWidth="10"
                  markerHeight="7"
                  refX="9"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#22c55e" />
                </marker>
              </defs>

              {/* Parallel execution indicator box */}
              {hasParallelRoots && rootNodes.length > 0 && (
                <g>
                  {/* Calculate bounding box for parallel tasks */}
                  {(() => {
                    const firstRootY = getNodeY(1, 0);
                    const lastRootY = getNodeY(1, rootNodes.length - 1);
                    const boxX = getNodeX(1) - 12;
                    const boxY = firstRootY - 24;
                    const boxWidth = nodeWidth + 24;
                    const boxHeight = lastRootY - firstRootY + nodeHeight + 48;

                    return (
                      <>
                        <rect
                          x={boxX}
                          y={boxY}
                          width={boxWidth}
                          height={boxHeight}
                          rx={8}
                          fill="none"
                          stroke="#22c55e"
                          strokeWidth={2}
                          strokeDasharray="6 3"
                          opacity={0.5}
                        />
                        <text
                          x={boxX + boxWidth / 2}
                          y={boxY - 6}
                          textAnchor="middle"
                          className="text-[10px] font-medium"
                          fill="#22c55e"
                        >
                          ⚡ PARALLEL ({rootNodes.length} tasks)
                        </text>
                      </>
                    );
                  })()}
                </g>
              )}

              {/* Edges from START to root nodes */}
              <g className="start-edges">
                {rootNodes.map((node) => {
                  const fromX = startX + startNodeWidth;
                  const fromY = startY + startNodeHeight / 2;
                  const toX = getNodeX(node.level);
                  const toY = getNodeY(node.level, node.position) + nodeHeight / 2;

                  // Fan-out effect for parallel tasks
                  const midX = (fromX + toX) / 2;

                  // For parallel tasks, create a branching effect
                  let path: string;
                  if (hasParallelRoots) {
                    // Draw branching lines
                    const branchX = fromX + 30;
                    path = `M ${fromX} ${fromY} L ${branchX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
                  } else {
                    path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
                  }

                  return (
                    <path
                      key={`start-to-${node.id}`}
                      d={path}
                      fill="none"
                      stroke={hasParallelRoots ? "#22c55e" : "#6366f1"}
                      strokeWidth={2}
                      markerEnd={
                        hasParallelRoots
                          ? "url(#arrowhead-parallel)"
                          : "url(#arrowhead)"
                      }
                    />
                  );
                })}
              </g>

              {/* Edges between task nodes */}
              <g className="task-edges">
                {taskEdges.map((edge, idx) => {
                  const fromX = getNodeX(edge.from.level) + nodeWidth;
                  const fromY =
                    getNodeY(edge.from.level, edge.from.position) +
                    nodeHeight / 2;
                  const toX = getNodeX(edge.to.level);
                  const toY =
                    getNodeY(edge.to.level, edge.to.position) + nodeHeight / 2;

                  // Curved path for dependencies
                  const midX = (fromX + toX) / 2;
                  const path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;

                  return (
                    <path
                      key={`edge-${idx}`}
                      d={path}
                      fill="none"
                      stroke="#6366f1"
                      strokeWidth={2}
                      markerEnd="url(#arrowhead)"
                    />
                  );
                })}
              </g>

              {/* START node */}
              <g transform={`translate(${startX}, ${startY})`}>
                <rect
                  width={startNodeWidth}
                  height={startNodeHeight}
                  rx={startNodeHeight / 2}
                  fill="#6366f1"
                  stroke="#818cf8"
                  strokeWidth={2}
                />
                <text
                  x={startNodeWidth / 2}
                  y={startNodeHeight / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  className="text-xs font-semibold"
                >
                  START
                </text>
              </g>

              {/* Task Nodes */}
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
                        rx={8}
                        className={`${getNodeFillClass(node.status)} ${getNodeBorderClass(node.status)}`}
                        strokeWidth={2}
                      />

                      {/* Status indicator & Story number */}
                      <text
                        x={12}
                        y={20}
                        className={`text-xs font-bold ${getStatusColorClass(node.status)}`}
                        fill="currentColor"
                      >
                        {getStatusIndicator(node.status)}
                      </text>
                      <text
                        x={26}
                        y={20}
                        className="text-xs font-mono"
                        fill="#6366f1"
                      >
                        #{node.index}
                      </text>

                      {/* Persona badge */}
                      <text
                        x={nodeWidth - 10}
                        y={20}
                        textAnchor="end"
                        className="text-[10px]"
                        fill="#9ca3af"
                      >
                        {node.personaEmoji} {node.persona}
                      </text>

                      {/* Title */}
                      <text
                        x={12}
                        y={42}
                        className="text-[11px]"
                        fill="#d1d5db"
                      >
                        {node.title}
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
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span className="text-muted-foreground font-medium">Legend:</span>
            <span className="flex items-center gap-1.5">
              <span className="text-green-500">✓</span>
              <span className="text-muted-foreground">Completed</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-blue-500">●</span>
              <span className="text-muted-foreground">Running</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-cyan-500">◐</span>
              <span className="text-muted-foreground">Claimed</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">○</span>
              <span className="text-muted-foreground">Queued</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-red-500">⊘</span>
              <span className="text-muted-foreground">Blocked</span>
            </span>
            <span className="border-l border-border pl-4 flex items-center gap-1.5">
              <span
                className="w-4 h-0.5 inline-block"
                style={{ backgroundColor: "#22c55e" }}
              ></span>
              <span className="text-muted-foreground">Parallel</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="w-4 h-0.5 inline-block"
                style={{ backgroundColor: "#6366f1" }}
              ></span>
              <span className="text-muted-foreground">Sequential</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline dependency graph component (for embedding in task cards)
export function InlineDependencyGraph({ stories, personaMap }: { stories: PlanStory[]; personaMap?: PersonaMap }) {
  const nodes = useMemo(() => calculateLayout(stories, personaMap), [stories, personaMap]);

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

  // Get root nodes (no dependencies)
  const rootNodes = useMemo(
    () => nodes.filter((n) => n.dependencies.length === 0),
    [nodes]
  );

  const maxNodesPerLevel = Math.max(
    ...Array.from(levelGroups.values()).map((g) => g.length),
    1
  );

  // Compact dimensions
  const nodeWidth = 100;
  const nodeHeight = 32;
  const levelGap = 50;
  const nodeGap = 10;
  const startNodeSize = 28;

  const svgWidth = (maxLevel + 1) * (nodeWidth + levelGap) + startNodeSize + 60;
  const svgHeight = Math.max(maxNodesPerLevel * (nodeHeight + nodeGap) + 30, 80);

  const getNodeX = (level: number) => startNodeSize + 35 + level * (nodeWidth + levelGap);
  const getNodeY = (level: number, position: number) => {
    const nodesInLevel = levelGroups.get(level)?.length || 1;
    const totalHeight = nodesInLevel * nodeHeight + (nodesInLevel - 1) * nodeGap;
    const startY = (svgHeight - totalHeight) / 2;
    return startY + position * (nodeHeight + nodeGap);
  };

  // START position
  const startX = 10;
  const startY = svgHeight / 2 - startNodeSize / 2;

  // Create edges between task nodes
  const taskEdges: Array<{ from: GraphNode; to: GraphNode }> = [];
  nodes.forEach((node) => {
    node.dependencies.forEach((depIdx) => {
      const depNode = nodes.find((n) => n.index === depIdx);
      if (depNode) {
        taskEdges.push({ from: depNode, to: node });
      }
    });
  });

  const hasParallelRoots = rootNodes.length > 1;

  if (stories.length === 0) {
    return null;
  }

  return (
    <div className="bg-muted/30 rounded-lg p-2 overflow-x-auto">
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ minWidth: svgWidth, minHeight: svgHeight }}
      >
        <defs>
          <marker
            id="arrowhead-inline"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="#6366f1" />
          </marker>
          <marker
            id="arrowhead-inline-parallel"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="#22c55e" />
          </marker>
        </defs>

        {/* Edges from START to root nodes */}
        <g className="start-edges">
          {rootNodes.map((node) => {
            const fromX = startX + startNodeSize;
            const fromY = startY + startNodeSize / 2;
            const toX = getNodeX(node.level);
            const toY = getNodeY(node.level, node.position) + nodeHeight / 2;

            const midX = (fromX + toX) / 2;
            const path = hasParallelRoots
              ? `M ${fromX} ${fromY} L ${fromX + 15} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`
              : `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;

            return (
              <path
                key={`start-to-${node.id}`}
                d={path}
                fill="none"
                stroke={hasParallelRoots ? "#22c55e" : "#6366f1"}
                strokeWidth={1.5}
                markerEnd={
                  hasParallelRoots
                    ? "url(#arrowhead-inline-parallel)"
                    : "url(#arrowhead-inline)"
                }
              />
            );
          })}
        </g>

        {/* Task edges */}
        <g className="task-edges">
          {taskEdges.map((edge, idx) => {
            const fromX = getNodeX(edge.from.level) + nodeWidth;
            const fromY =
              getNodeY(edge.from.level, edge.from.position) + nodeHeight / 2;
            const toX = getNodeX(edge.to.level);
            const toY =
              getNodeY(edge.to.level, edge.to.position) + nodeHeight / 2;

            const midX = (fromX + toX) / 2;
            const path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;

            return (
              <path
                key={`edge-${idx}`}
                d={path}
                fill="none"
                stroke="#6366f1"
                strokeWidth={1.5}
                markerEnd="url(#arrowhead-inline)"
              />
            );
          })}
        </g>

        {/* START node */}
        <g transform={`translate(${startX}, ${startY})`}>
          <circle
            cx={startNodeSize / 2}
            cy={startNodeSize / 2}
            r={startNodeSize / 2}
            fill="#6366f1"
            stroke="#818cf8"
            strokeWidth={1.5}
          />
          <text
            x={startNodeSize / 2}
            y={startNodeSize / 2 + 1}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="white"
            className="text-[8px] font-semibold"
          >
            ▶
          </text>
        </g>

        {/* Task Nodes */}
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
                  className={`${getNodeFillClass(node.status)} ${getNodeBorderClass(node.status)}`}
                  strokeWidth={1.5}
                />

                {/* Status + Story number */}
                <text
                  x={8}
                  y={20}
                  className={`text-[10px] font-mono ${getStatusColorClass(node.status)}`}
                  fill="currentColor"
                >
                  {getStatusIndicator(node.status)} #{node.index}
                </text>

                {/* Persona emoji */}
                <text
                  x={nodeWidth - 8}
                  y={20}
                  textAnchor="end"
                  className="text-[10px]"
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

// Parent task status type for PRD workflow
type ParentTaskStatus = "planning" | "pending_plan_approval" | "executing" | "completed" | "failed" | "cancelled" | string;

// Check if parent is actively orchestrating
function isParentActive(status: ParentTaskStatus | undefined): boolean {
  return status === "executing" || status === "claimed" || status === "environment_setup";
}

// Get parent status display
function getParentStatusInfo(status: ParentTaskStatus | undefined): { label: string; color: string; bgColor: string } {
  switch (status) {
    case "planning":
      return { label: "Planning", color: "#a855f7", bgColor: "#a855f7" };
    case "pending_plan_approval":
      return { label: "Awaiting", color: "#f59e0b", bgColor: "#f59e0b" };
    case "executing":
    case "claimed":
    case "environment_setup":
      return { label: "Running", color: "#3b82f6", bgColor: "#3b82f6" };
    case "completed":
    case "deployed":
      return { label: "Done", color: "#22c55e", bgColor: "#22c55e" };
    case "failed":
    case "cancelled":
      return { label: "Failed", color: "#ef4444", bgColor: "#ef4444" };
    default:
      return { label: "Orchestrating", color: "#6366f1", bgColor: "#6366f1" };
  }
}

// Embedded dependency graph for side panel (larger than inline, no modal)
export function EmbeddedDependencyGraph({ stories, parentTaskStatus, personaMap }: { stories: PlanStory[]; parentTaskStatus?: ParentTaskStatus; personaMap?: PersonaMap }) {
  const nodes = useMemo(() => calculateLayout(stories, personaMap), [stories, personaMap]);

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

  const rootNodes = useMemo(
    () => nodes.filter((n) => n.dependencies.length === 0),
    [nodes]
  );

  const maxNodesPerLevel = Math.max(
    ...Array.from(levelGroups.values()).map((g) => g.length),
    1
  );

  // Medium dimensions for embedded view
  const nodeWidth = 160;
  const nodeHeight = 48;
  const levelGap = 70;
  const nodeGap = 14;
  const startNodeWidth = 70;
  const startNodeHeight = 32;

  const svgWidth = (maxLevel + 1) * (nodeWidth + levelGap) + startNodeWidth + 80;
  const svgHeight = Math.max(maxNodesPerLevel * (nodeHeight + nodeGap) + 60, 160);

  const getNodeX = (level: number) => startNodeWidth + 40 + level * (nodeWidth + levelGap);
  const getNodeY = (level: number, position: number) => {
    const nodesInLevel = levelGroups.get(level)?.length || 1;
    const totalHeight = nodesInLevel * nodeHeight + (nodesInLevel - 1) * nodeGap;
    const startY = (svgHeight - totalHeight) / 2;
    return startY + position * (nodeHeight + nodeGap);
  };

  const startX = 15;
  const startY = svgHeight / 2 - startNodeHeight / 2;

  const taskEdges: Array<{ from: GraphNode; to: GraphNode }> = [];
  nodes.forEach((node) => {
    node.dependencies.forEach((depIdx) => {
      const depNode = nodes.find((n) => n.index === depIdx);
      if (depNode) {
        taskEdges.push({ from: depNode, to: node });
      }
    });
  });

  const hasParallelRoots = rootNodes.length > 1;

  if (stories.length === 0) {
    return null;
  }

  return (
    <div className="bg-muted/30 rounded-lg p-3 overflow-x-auto border border-border/50">
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ minWidth: svgWidth, minHeight: svgHeight }}
      >
        <defs>
          <marker
            id="arrowhead-embedded"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="#6366f1" />
          </marker>
          <marker
            id="arrowhead-embedded-parallel"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="#22c55e" />
          </marker>
          {/* Pulse animation for active nodes */}
          <style>
            {`
              @keyframes pulse-ring {
                0% { opacity: 0.6; transform: scale(1); }
                50% { opacity: 0.2; transform: scale(1.15); }
                100% { opacity: 0.6; transform: scale(1); }
              }
              @keyframes pulse-glow {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.6; }
              }
              .pulse-ring {
                animation: pulse-ring 2s ease-in-out infinite;
                transform-origin: center;
                transform-box: fill-box;
              }
              .pulse-glow {
                animation: pulse-glow 1.5s ease-in-out infinite;
              }
            `}
          </style>
        </defs>

        {/* Parallel execution indicator box */}
        {hasParallelRoots && rootNodes.length > 0 && (
          <g>
            {(() => {
              const firstRootY = getNodeY(1, 0);
              const lastRootY = getNodeY(1, rootNodes.length - 1);
              const boxX = getNodeX(1) - 10;
              const boxY = firstRootY - 18;
              const boxWidth = nodeWidth + 20;
              const boxHeight = lastRootY - firstRootY + nodeHeight + 36;

              return (
                <>
                  <rect
                    x={boxX}
                    y={boxY}
                    width={boxWidth}
                    height={boxHeight}
                    rx={6}
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                    opacity={0.5}
                  />
                  <text
                    x={boxX + boxWidth / 2}
                    y={boxY - 4}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="500"
                    fill="#22c55e"
                  >
                    ⚡ PARALLEL ({rootNodes.length})
                  </text>
                </>
              );
            })()}
          </g>
        )}

        {/* Edges from START to root nodes */}
        <g className="start-edges">
          {rootNodes.map((node) => {
            const fromX = startX + startNodeWidth;
            const fromY = startY + startNodeHeight / 2;
            const toX = getNodeX(node.level);
            const toY = getNodeY(node.level, node.position) + nodeHeight / 2;

            const midX = (fromX + toX) / 2;
            const path = hasParallelRoots
              ? `M ${fromX} ${fromY} L ${fromX + 20} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`
              : `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;

            return (
              <path
                key={`start-to-${node.id}`}
                d={path}
                fill="none"
                stroke={hasParallelRoots ? "#22c55e" : "#6366f1"}
                strokeWidth={1.5}
                markerEnd={
                  hasParallelRoots
                    ? "url(#arrowhead-embedded-parallel)"
                    : "url(#arrowhead-embedded)"
                }
              />
            );
          })}
        </g>

        {/* Task edges */}
        <g className="task-edges">
          {taskEdges.map((edge, idx) => {
            const fromX = getNodeX(edge.from.level) + nodeWidth;
            const fromY =
              getNodeY(edge.from.level, edge.from.position) + nodeHeight / 2;
            const toX = getNodeX(edge.to.level);
            const toY =
              getNodeY(edge.to.level, edge.to.position) + nodeHeight / 2;

            const midX = (fromX + toX) / 2;
            const path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;

            return (
              <path
                key={`edge-${idx}`}
                d={path}
                fill="none"
                stroke="#6366f1"
                strokeWidth={1.5}
                markerEnd="url(#arrowhead-embedded)"
              />
            );
          })}
        </g>

        {/* PRD Orchestrator node (parent task) */}
        <g transform={`translate(${startX}, ${startY})`}>
          {/* Pulse ring for active parent */}
          {isParentActive(parentTaskStatus) && (
            <rect
              x={-4}
              y={-4}
              width={startNodeWidth + 8}
              height={startNodeHeight + 8}
              rx={(startNodeHeight + 8) / 2}
              fill="none"
              stroke={getParentStatusInfo(parentTaskStatus).color}
              strokeWidth={2}
              className="pulse-ring"
              opacity={0.5}
            />
          )}
          <rect
            width={startNodeWidth}
            height={startNodeHeight}
            rx={startNodeHeight / 2}
            fill={getParentStatusInfo(parentTaskStatus).bgColor}
            stroke={getParentStatusInfo(parentTaskStatus).color}
            strokeWidth={1.5}
            className={isParentActive(parentTaskStatus) ? "pulse-glow" : ""}
          />
          <text
            x={startNodeWidth / 2}
            y={startNodeHeight / 2 - 4}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="white"
            fontSize="8"
            fontWeight="500"
          >
            📋 PRD
          </text>
          <text
            x={startNodeWidth / 2}
            y={startNodeHeight / 2 + 7}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="white"
            fontSize="7"
            opacity={0.9}
          >
            {getParentStatusInfo(parentTaskStatus).label}
          </text>
        </g>

        {/* Task Nodes */}
        <g className="nodes">
          {nodes.map((node) => {
            const x = getNodeX(node.level);
            const y = getNodeY(node.level, node.position);
            const isActive = isActiveStatus(node.status);

            return (
              <g key={node.id} transform={`translate(${x}, ${y})`}>
                {/* Pulse ring for active nodes */}
                {isActive && (
                  <rect
                    x={-3}
                    y={-3}
                    width={nodeWidth + 6}
                    height={nodeHeight + 6}
                    rx={8}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    className="pulse-ring"
                    opacity={0.5}
                  />
                )}
                <rect
                  width={nodeWidth}
                  height={nodeHeight}
                  rx={6}
                  className={`${getNodeFillClass(node.status)} ${getNodeBorderClass(node.status)} ${isActive ? "pulse-glow" : ""}`}
                  strokeWidth={isActive ? 2 : 1.5}
                />

                {/* Status indicator & Story number */}
                <text
                  x={10}
                  y={18}
                  className={`text-[10px] font-bold ${getStatusColorClass(node.status)} ${isActive ? "pulse-glow" : ""}`}
                  fill="currentColor"
                >
                  {getStatusIndicator(node.status)}
                </text>
                <text
                  x={22}
                  y={18}
                  fontSize="10"
                  fontFamily="monospace"
                  fill="#6366f1"
                >
                  S{node.index}
                </text>

                {/* Persona badge */}
                <text
                  x={nodeWidth - 8}
                  y={18}
                  textAnchor="end"
                  fontSize="9"
                  fill="#9ca3af"
                >
                  {node.personaEmoji} {node.persona}
                </text>

                {/* Title */}
                <text x={10} y={36} fontSize="10" fill="#d1d5db">
                  {node.title}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Mini legend */}
      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span
            className="w-3 h-0.5 inline-block rounded"
            style={{ backgroundColor: "#22c55e" }}
          />
          Parallel
        </span>
        <span className="flex items-center gap-1">
          <span
            className="w-3 h-0.5 inline-block rounded"
            style={{ backgroundColor: "#6366f1" }}
          />
          Sequential
        </span>
      </div>
    </div>
  );
}
