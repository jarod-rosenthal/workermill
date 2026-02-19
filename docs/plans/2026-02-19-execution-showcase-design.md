# Execution Showcase — Animated Step-Through Design

**Date:** 2026-02-19

## Context

The landing page hero has a BuildTerminal where visitors describe a project and see a cached plan preview. But there's nothing showing what happens *after* you hit Build — the actual execution lifecycle. Real tasks take hours, so video isn't practical. We need a React-rendered animation that fast-forwards through the full PRD → epics → execution → PR workflow.

## Design

### Component: `ExecutionShowcase`

A self-contained React component that auto-plays through 7 frames in a ~24-second loop, rendered as styled React elements mimicking VS Code's UI (dark theme, sidebar tree, terminal output). Not screenshots or video — pure JSX so it stays fresh as the product evolves.

### Placement

In `LandingV0.tsx`, immediately after the BuildTerminal + starter pills section, before the ShowcaseGallery:

```
Hero headline
  ↓
BuildTerminal (describe a project, see the plan)
  ↓
[NEW] ExecutionShowcase (animated lifecycle)
  ↓
ShowcaseGallery
```

### Frames

| # | Duration | Visual | Caption |
|---|----------|--------|---------|
| 1 | 3s | VS Code file tree with a PRD file selected, context menu open, "WorkerMill: Build from PRD" highlighted | Right-click any PRD. One click to build. |
| 2 | 4s | Terminal output scrolling: "Decomposing PRD into epics..." Sidebar populates with 6 epics, all showing orange lock icons | PRD decomposes into sequenced epics |
| 3 | 3s | First epic unlocks (lock disappears, turns green/active). Label: "Project Setup & Dev Environment". Planning indicator appears | First epic starts — planning agent decomposes into stories |
| 4 | 4s | Stories list with expert persona badges (devops_engineer, backend_developer). Progress bars advancing. Mini terminal showing code output | Parallel experts execute stories |
| 5 | 3s | "Tech Lead: Approved" badge appears. First epic gets a green checkmark. Second epic's lock disappears | Quality gate passed — next epic unlocks |
| 6 | 3s | Fast montage: remaining epics completing one by one, locks disappearing, checkmarks appearing in sequence | Epics complete autonomously in sequence |
| 7 | 4s | All epics checked off. Terminal shows "PR pushed to main". Green "PR Ready" badge. Repo link | Full build complete — PR ready for review |

Total loop: ~24 seconds. Pauses briefly at frame 7 before restarting.

### Visual Style

- **Container**: Mimics VS Code window chrome (same `VSCodeFrame` pattern from AgentCollaboration, with the VS Code icon title bar)
- **Layout**: Left sidebar (~30%) showing epic tree with lock/check icons. Right area (~70%) showing the active content (terminal, stories, review status) for the current frame
- **Color palette**: VS Code dark theme background (`#1e1e1e`), sidebar (`#252526`). Accent colors: orange for locked, green for complete, blue for in-progress, violet for tech lead
- **Animations**: Crossfade between frames. Progress bars animate. Terminal text types in. Lock icons fade to checkmarks
- **Responsive**: On mobile, sidebar collapses — show only the right-side content with a simplified epic progress indicator

### Section Header

Above the component:
- Eyebrow: "FROM PRD TO PR"
- Headline: "One document in. Production code out."
- Subtitle: "Drop a PRD, walk away. WorkerMill decomposes it into epics, sequences the work, and executes each one — planned, coded, tested, and reviewed."

### Data

All frame content is hardcoded — no API calls. Uses the ShipAPI example from the screenshots (realistic epic names: Project Setup, AWS Infrastructure, CI/CD Pipelines, Authentication System, Category & Product CRUD, Stock Management).

## Files

- `frontend/src/components/ExecutionShowcase.tsx` — new component (main orchestrator + frame renderer)
- `frontend/src/pages/LandingV0.tsx` — import + place after BuildTerminal section

## Not in scope

- Interactive controls (play/pause/scrub) — auto-play only
- Real API data — all hardcoded
- Video or screenshot assets — pure React rendering
