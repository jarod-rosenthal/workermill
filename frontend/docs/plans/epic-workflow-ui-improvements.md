# Epic Workflow UI Improvements Plan

## Overview

This plan addresses three UI improvements for Epic workflow tasks on the Dashboard:

1. Auto-collapse execution plan when Epic task starts executing
2. New distinctive icons for Epic workflow
3. Percentage-based progress indicator for subtasks

---

## Current State

### Dashboard.tsx Execution Plan Display (lines 1875-2100)

- `expandedPlans` state (`Set<string>`) tracks which plans are expanded
- Approved plans are collapsed by default (only show if `expandedPlans.has(task.id)`)
- Uses `Book` icon for all execution plans (no Epic differentiation)
- No prominent progress indicator for Epic subtasks

### Epic Mode Detection (lines 2473-2478)

```typescript
const isEpicMode = selectedTask.pipelineVersion === "v2" ||
  selectedTask.isRalphTask === true ||
  (selectedTask.childTaskIds && selectedTask.childTaskIds.length > 0)
```

### Existing Components

- `RalphProgress` / `RalphProgressCompact` - Progress bars for multi-story tasks
- `ProgressRing` / `EpicStageIcon` - Circular progress indicators (in Orchestration page)

---

## 1. Auto-collapse Execution Plan When Epic Starts Executing

### Problem

When an Epic-labeled Jira ticket is picked up and transitions from `pending_plan_approval` to executing, the execution plan box should automatically collapse to save screen space.

### Solution

Add a `useEffect` hook that monitors Epic tasks and removes them from `expandedPlans` when they start executing:

```typescript
// Add near other useEffect hooks in Dashboard.tsx

// Auto-collapse execution plan when Epic task starts executing
useEffect(() => {
  const epicTasks = data?.activeTasks?.filter(task =>
    task.pipelineVersion === "v2" ||
    task.isRalphTask ||
    (task.childTaskIds && task.childTaskIds.length > 0)
  ) || [];

  epicTasks.forEach(task => {
    // If task is now executing and plan is expanded, collapse it
    if (task.status !== "pending_plan_approval" && expandedPlans.has(task.id)) {
      setExpandedPlans(prev => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  });
}, [data?.activeTasks]);
```

### Files to Modify

- `frontend/src/pages/Dashboard.tsx`

---

## 2. New Icons for Epic Workflow

### Problem

Currently using the same `Book` icon for both standard and Epic execution plans. Need visual differentiation to immediately identify Epic workflows.

### Recommended Icon Mapping

| Context | Current Icon | Recommended Epic Icon | Import From | Reasoning |
|---------|--------------|----------------------|-------------|-----------|
| Plan Header | `Book` | `Layers` | lucide-react | Multi-layer/multi-story structure |
| Epic Badge | none | `Zap` | lucide-react | Lightning = parallel/fast execution |
| Dependency Graph | `Network` | `Network` (keep) | lucide-react | Already appropriate |
| Stories List | numbered bullets | `GitFork` | lucide-react | Branching parallel work |
| Coordination | `MessageSquare` | `Users` | lucide-react | Multi-expert collaboration |

### Implementation

#### Plan Header (around line 1901)

```typescript
// Replace current Book icon with conditional rendering
{isEpicTask ? (
  <Layers className={`w-5 h-5 ${
    task.status === "pending_plan_approval" ? "text-primary" : "text-green-500"
  }`} />
) : (
  <Book className={`w-5 h-5 ${
    task.status === "pending_plan_approval" ? "text-primary" : "text-green-500"
  }`} />
)}
```

#### Epic Badge (after line 1906)

```typescript
// Add Epic badge next to title for Epic tasks
{isEpicTask && (
  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-500 flex items-center gap-1">
    <Zap className="w-3 h-3" />
    Epic
  </span>
)}
```

#### Helper Function

```typescript
// Add helper to detect Epic tasks
function isEpicTask(task: ActiveTask): boolean {
  return task.pipelineVersion === "v2" ||
    task.isRalphTask === true ||
    (task.childTaskIds && task.childTaskIds.length > 0);
}
```

### Files to Modify

- `frontend/src/pages/Dashboard.tsx`
  - Add imports: `Layers`, `Zap`, `GitFork`, `Users` from lucide-react
  - Add `isEpicTask()` helper function
  - Update plan header rendering

---

## 3. Progress Indicator (Percentage-Based)

### Problem

No prominent visual indicator showing overall Epic progress as a percentage relative to total subtasks.

### Solution Options

#### Option A: Circular Progress Ring (Recommended)

Create a new component for visual percentage display:

**New File: `frontend/src/components/EpicProgressRing.tsx`**

```typescript
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
```

#### Option B: Inline Progress Bar

Add progress bar directly in the plan header:

```typescript
// After the "Approved" badge (around line 1916), add progress indicator
{isEpicTask(task) && task.childTaskIds && task.childTaskIds.length > 0 && (
  <div className="flex items-center gap-2 ml-2">
    <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
      <div
        className="h-full bg-green-500 transition-all duration-500"
        style={{ width: `${getEpicProgress(task)}%` }}
      />
    </div>
    <span className="text-xs text-muted-foreground">
      {getEpicProgress(task)}%
    </span>
  </div>
)}
```

### Helper Function for Progress Calculation

```typescript
function getEpicProgress(task: ActiveTask): number {
  // Use Ralph progress if available
  if (task.ralphProgress) {
    const { completedStories = 0, totalStories } = task.ralphProgress;
    return totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;
  }

  // Fallback: would need child task status from API
  // For now return 0 if no progress data
  return 0;
}
```

### Files to Modify

- `frontend/src/components/EpicProgressRing.tsx` (new file)
- `frontend/src/pages/Dashboard.tsx`
  - Import `EpicProgressRing` or `EpicProgressCompact`
  - Add `getEpicProgress()` helper function
  - Add progress indicator to plan header

---

## Implementation Summary

| Feature | File(s) | Type |
|---------|---------|------|
| Auto-collapse | `Dashboard.tsx` | Modify - add useEffect |
| Epic Icons | `Dashboard.tsx` | Modify - conditional icons |
| Progress Ring | `EpicProgressRing.tsx` | New component |
| Progress Display | `Dashboard.tsx` | Modify - add to header |

### New Imports Needed in Dashboard.tsx

```typescript
import { Layers, Zap, GitFork, Users } from "lucide-react";
import { EpicProgressRing } from "../components/EpicProgressRing";
```

---

## Visual Mockup (ASCII)

### Before (Standard Plan)
```
┌─────────────────────────────────────────────────┐
│ 📖 Approved Execution Plan  ✓ Approved  ▼       │
└─────────────────────────────────────────────────┘
```

### After (Epic Plan)
```
┌─────────────────────────────────────────────────┐
│ 📚 Approved Execution Plan  ⚡Epic  ✓ Approved  │
│                                                 │
│  ┌──┐  67%  3/5 stories complete       ▼       │
│  │██│                                          │
│  └──┘                                          │
└─────────────────────────────────────────────────┘
```

---

## Notes

- The `ProgressRing` component already exists in `/frontend/src/components/ProgressRing.tsx` but is designed for the Orchestration page. Consider reusing or adapting it.
- `RalphProgress` component provides progress data structure that can be leveraged
- Consider adding WebSocket/SSE subscription to get real-time progress updates for child tasks
