# Local-First Narrative Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add local-first trust messaging to the homepage — a hero badge and an enterprise trust callout above pricing with honest data-flow disclosure.

**Architecture:** Two changes woven into the existing landing page. Hero badge is inline JSX in LandingV0.tsx. Trust callout is a new standalone component placed above Pricing.

**Tech Stack:** React, TailwindCSS, lucide-react icons

---

### Task 1: Add hero trust badge

**Files:**
- Modify: `frontend/src/pages/LandingV0.tsx:137-150` (hero section)

**Step 1: Add Lock import**

In `LandingV0.tsx`, add `Lock` to the lucide-react import:

```tsx
import { Home, Search, FolderOpen, Sparkles, Lock } from "lucide-react";
```

**Step 2: Add trust badge below subtitle**

Insert after the closing `</p>` of the subtitle (line 148), before the closing `</div>` and `</section>`:

```tsx
              {/* Trust badge */}
              <div className="mt-4 flex justify-center">
                <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20 tracking-wide backdrop-blur-sm">
                  <Lock className="w-3 h-3" />
                  Local-first — your code executes on your machine, not ours.
                </span>
              </div>
```

**Step 3: Verify type check passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add frontend/src/pages/LandingV0.tsx
git commit -m "feat: add local-first trust badge to homepage hero"
```

---

### Task 2: Create TrustCallout component

**Files:**
- Create: `frontend/src/components/TrustCallout.tsx`

**Step 1: Create the component**

```tsx
import { useState } from "react";
import { ShieldCheck, ChevronDown } from "lucide-react";

const disclosureItems = [
  {
    label: "Task metadata",
    detail: "Status, timing, token usage",
  },
  {
    label: "Execution logs",
    detail: "Terminal output streamed to the dashboard",
  },
  {
    label: "Execution plans",
    detail: "Story descriptions, file paths, steps",
  },
  {
    label: "Code events",
    detail: "File edits for the Live Code Viewer",
  },
];

export default function TrustCallout() {
  const [open, setOpen] = useState(false);

  return (
    <section className="py-20 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-950/5 to-transparent" />

      <div className="relative max-w-3xl mx-auto px-6 lg:px-8">
        <div className="bg-slate-900/80 backdrop-blur-sm border border-white/10 rounded-2xl p-8 lg:p-10">
          {/* Icon + headline */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-white">
              Zero-trust AI engineering.
            </h2>
          </div>

          {/* Body */}
          <p className="text-lg text-slate-400 leading-relaxed mb-6">
            WorkerMill executes on your infrastructure &mdash; the agent runs
            locally, clones your repo locally, pushes from your machine. We
            never clone or run your code.
          </p>

          {/* Expandable disclosure */}
          <div className="border-t border-white/5 pt-5">
            <button
              onClick={() => setOpen(!open)}
              className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-300 transition-colors"
            >
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${
                  open ? "rotate-180" : ""
                }`}
              />
              What we see in remote mode
            </button>

            <div
              className={`grid transition-all duration-300 ease-in-out ${
                open
                  ? "grid-rows-[1fr] opacity-100 mt-4"
                  : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <div className="grid sm:grid-cols-2 gap-3">
                  {disclosureItems.map((item) => (
                    <div
                      key={item.label}
                      className="bg-slate-800/50 rounded-lg px-4 py-3 border border-white/5"
                    >
                      <p className="text-sm font-medium text-slate-300">
                        {item.label}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {item.detail}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-600 mt-3">
                  Source code is never stored on our servers. All data is
                  encrypted in transit (TLS) and ephemeral.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
```

**Step 2: Verify type check passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add frontend/src/components/TrustCallout.tsx
git commit -m "feat: add TrustCallout component with data-flow disclosure"
```

---

### Task 3: Wire TrustCallout into LandingV0 above Pricing

**Files:**
- Modify: `frontend/src/pages/LandingV0.tsx:214-220` (above Pricing section)

**Step 1: Add import**

Add to the imports in `LandingV0.tsx`:

```tsx
import TrustCallout from "../components/TrustCallout";
```

**Step 2: Place component above Pricing**

Insert `<TrustCallout />` just before the Pricing section comment:

```tsx
          {/* Trust & Security Callout */}
          <TrustCallout />

          {/* Pricing Section */}
          <section id="pricing">
            <Pricing />
          </section>
```

**Step 3: Verify type check passes**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add frontend/src/pages/LandingV0.tsx
git commit -m "feat: place TrustCallout above Pricing on homepage"
```

---

### Task 4: Visual verification

**Step 1: Start dev server if not running**

Run: `cd frontend && npm run dev`

**Step 2: Check hero badge**

Open http://localhost:5173, verify the trust badge pill appears below the subtitle with lock icon and teal styling.

**Step 3: Check trust callout**

Scroll to just above Pricing. Verify:
- Shield icon + "Zero-trust AI engineering." headline visible
- Body text about local execution visible
- "What we see in remote mode" is collapsed by default
- Clicking it expands to show 4 disclosure items in a 2x2 grid
- Collapsing works smoothly

**Step 4: Final commit with any style tweaks**

If any spacing/alignment tweaks are needed, make them and commit:

```bash
git add -A
git commit -m "fix: adjust local-first section spacing"
```
