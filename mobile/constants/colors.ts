// Brand colors (matching Tailwind config)
export const brandColors = {
  50: "#eef2ff",
  500: "#6366f1",
  600: "#4f46e5",
  700: "#4338ca",
  900: "#312e81",
} as const;

// Status colors (hex values matching Tailwind table in StatusBadge spec)
export const statusColors = {
  // Active statuses
  active: "#22c55e", // bg-green-500

  // Queued statuses
  queued: "#facc15", // bg-yellow-400

  // Planning statuses
  planning: "#2563eb", // bg-blue-600

  // Waiting statuses
  waiting: "#9333ea", // bg-purple-600

  // Completed statuses
  completed: "#475569", // bg-slate-600

  // Failed statuses
  failed: "#ef4444", // bg-red-500
} as const;

// Additional slate colors
export const slateColors = {
  850: "#172033",
  950: "#0f172a",
} as const;