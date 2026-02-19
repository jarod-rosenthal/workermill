# Local-First Narrative — Homepage Design

**Date:** 2026-02-18
**Approach:** Weave into existing sections (Approach B)

## Context

WorkerMill's structural differentiator is local-first execution. The remote agent runs on the user's machine, clones repos locally, and pushes from their infrastructure. Competitors like Devin execute code in their cloud.

However, in remote agent mode, some data does flow through workermill.com: task metadata, execution logs, plans, code events (for the live dashboard), diffs (for quality gates), and error output. The "code never leaves your machine" claim is only fully true in local WorkerMill mode.

The messaging must lead with local-first as the default path while being transparent about what workermill.com sees in remote mode.

## Changes

### 1. Hero Trust Badge (LandingV0.tsx)

Add a pill badge with a lock icon below the existing subtitle paragraph:

```
🔒 Local-first — your code executes on your machine, not ours.
```

- Muted style (slate text, subtle border), not attention-grabbing
- Placed after the subtitle, before the BuildTerminal
- Matches the badge pattern from the old Hero.tsx

### 2. Enterprise Trust Callout (new component, above Pricing)

Dark card with shield icon placed in LandingV0.tsx just above the Pricing section.

**Content:**

Headline: "Zero-trust AI engineering."

Body: "WorkerMill executes on your infrastructure — the agent runs locally, clones your repo locally, pushes from your machine. We never clone or run your code."

Expandable disclosure: "What we see in remote mode"
- Task metadata (status, timing, token usage)
- Execution logs (terminal output streamed to the dashboard)
- Execution plans (story descriptions, file paths, steps)
- Code events (file edits for the Live Code Viewer)

Style: Dark card, muted border, shield icon. Optional CTA to future /security page.

## Files

- `frontend/src/pages/LandingV0.tsx` — add badge + import/place trust callout
- `frontend/src/components/TrustCallout.tsx` — new component

## What's NOT in scope

- Dedicated /security page (future work)
- Architecture diagrams
- Changes to CompetitiveComparison component
- Changes to FeaturesGrid or other existing sections
