interface TicketPriorityBadgeProps {
  priority: string;
}

const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  low: {
    label: "Low",
    className: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  },
  medium: {
    label: "Medium",
    className: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  },
  high: {
    label: "High",
    className: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  },
  urgent: {
    label: "Urgent",
    className: "bg-red-500/10 text-red-500 border-red-500/20",
  },
};

export function TicketPriorityBadge({ priority }: TicketPriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${config.className}`}
    >
      {config.label}
    </span>
  );
}
