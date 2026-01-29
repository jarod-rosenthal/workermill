import { CheckCircle, Clock, AlertCircle, MessageSquare, XCircle } from "lucide-react";

interface TicketStatusBadgeProps {
  status: string;
}

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  open: {
    label: "Open",
    className: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    icon: <AlertCircle className="w-3 h-3" />,
  },
  in_progress: {
    label: "In Progress",
    className: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    icon: <Clock className="w-3 h-3" />,
  },
  waiting: {
    label: "Waiting",
    className: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    icon: <MessageSquare className="w-3 h-3" />,
  },
  resolved: {
    label: "Resolved",
    className: "bg-green-500/10 text-green-500 border-green-500/20",
    icon: <CheckCircle className="w-3 h-3" />,
  },
  closed: {
    label: "Closed",
    className: "bg-muted text-muted-foreground border-border",
    icon: <XCircle className="w-3 h-3" />,
  },
};

export function TicketStatusBadge({ status }: TicketStatusBadgeProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.open;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${config.className}`}
    >
      {config.icon}
      {config.label}
    </span>
  );
}
