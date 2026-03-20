// Brand colors matching Tailwind config
export const BRAND_COLORS = {
  brand: {
    50: "#eef2ff",
    500: "#6366f1",
    600: "#4f46e5",
    700: "#4338ca",
    900: "#312e81",
  },
  slate: {
    850: "#172033",
    950: "#0f172a",
  },
} as const;

// Status colors matching StatusBadge spec
export const STATUS_COLORS = {
  // Active statuses: executing, consolidating, deploying, running, integration_check
  active: {
    bg: "#22c55e", // bg-green-500
    text: "#ffffff", // text-white
  },
  // Queued statuses: queued, claimed, environment_setup, dispatching
  queued: {
    bg: "#facc15", // bg-yellow-400
    text: "#0f172a", // text-slate-900
  },
  // Planning statuses: planning, pending_plan_approval
  planning: {
    bg: "#2563eb", // bg-blue-600
    text: "#ffffff", // text-white
  },
  // Waiting statuses: blocked, pr_created, review_requested, manager_review, revision_needed, pr_approved, review_approved, escalated
  waiting: {
    bg: "#9333ea", // bg-purple-600
    text: "#ffffff", // text-white
  },
  // Completed statuses: completed, deployed
  completed: {
    bg: "#475569", // bg-slate-600
    text: "#ffffff", // text-white
  },
  // Failed statuses: failed, cancelled, review_rejected
  failed: {
    bg: "#ef4444", // bg-red-500
    text: "#ffffff", // text-white
  },
} as const;