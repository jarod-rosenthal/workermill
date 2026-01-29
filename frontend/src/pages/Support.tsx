import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  MessageSquare,
  Clock,
  AlertCircle,
  CheckCircle,
  Loader2,
  Filter,
  Search,
  ChevronRight,
  HelpCircle,
  Bug,
  CreditCard,
  Lightbulb,
  Wrench,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";
import { CreateTicketModal } from "../components/support/CreateTicketModal";
import { TicketStatusBadge } from "../components/support/TicketStatusBadge";
import { TicketPriorityBadge } from "../components/support/TicketPriorityBadge";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface SupportTicket {
  id: string;
  ticketKey: string;
  subject: string;
  status: string;
  statusDisplay: string;
  priority: string;
  category: string;
  createdBy: { id: string; email: string; fullName: string | null } | null;
  assignedTo: { id: string; email: string; fullName: string | null } | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  general: <HelpCircle className="w-4 h-4" />,
  billing: <CreditCard className="w-4 h-4" />,
  technical: <Wrench className="w-4 h-4" />,
  feature_request: <Lightbulb className="w-4 h-4" />,
  bug_report: <Bug className="w-4 h-4" />,
};

const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  billing: "Billing",
  technical: "Technical",
  feature_request: "Feature Request",
  bug_report: "Bug Report",
};

// Users allowed to access the Support admin view
const SUPPORT_ADMIN_EMAILS = [
  "jarod@oncallshift.com",
];

export default function Support() {
  const navigate = useNavigate();
  const tokens = useAuthStore((state) => state.tokens);
  const user = useAuthStore((state) => state.user);

  // Access control - only allow specific users to view support admin
  const hasAccess = user?.email && SUPPORT_ADMIN_EMAILS.includes(user.email);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchTickets = useCallback(async () => {
    if (!tokens?.accessToken) return;

    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      params.set("limit", "50");

      const res = await fetch(`${API_BASE}/api/support/tickets?${params}`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });

      if (!res.ok) {
        throw new Error("Failed to fetch tickets");
      }

      const data = await res.json();
      setTickets(data.tickets);
      setTotal(data.total);
    } catch (err) {
      console.error("Failed to fetch tickets:", err);
      setError("Failed to load support tickets");
    } finally {
      setLoading(false);
    }
  }, [tokens?.accessToken, statusFilter, categoryFilter]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleTicketCreated = () => {
    setShowCreateModal(false);
    fetchTickets();
  };

  const filteredTickets = tickets.filter((ticket) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      ticket.ticketKey.toLowerCase().includes(query) ||
      ticket.subject.toLowerCase().includes(query)
    );
  });

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Access denied view
  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="bg-card rounded-lg border border-border p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Access Denied</h2>
          <p className="text-muted-foreground mb-6">
            You don't have permission to view the Support Admin dashboard.
          </p>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link
                to="/dashboard"
                className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-muted-foreground" />
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-foreground">Support</h1>
                <p className="text-sm text-muted-foreground">
                  Get help with WorkerMill
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Ticket
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <div className="bg-card rounded-lg border border-border p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search tickets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-muted/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Status Filter */}
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="appearance-none pl-4 pr-10 py-2 bg-muted/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
              >
                <option value="">All Statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="waiting">Waiting</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
              <Filter className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>

            {/* Category Filter */}
            <div className="relative">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="appearance-none pl-4 pr-10 py-2 bg-muted/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
              >
                <option value="">All Categories</option>
                <option value="general">General</option>
                <option value="billing">Billing</option>
                <option value="technical">Technical</option>
                <option value="feature_request">Feature Request</option>
                <option value="bug_report">Bug Report</option>
              </select>
              <Filter className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Tickets List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6 text-center">
            <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
            <p className="text-destructive">{error}</p>
            <button
              onClick={fetchTickets}
              className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="bg-card rounded-lg border border-border p-12 text-center">
            <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              {tickets.length === 0 ? "No support tickets yet" : "No tickets match your filters"}
            </h3>
            <p className="text-muted-foreground mb-6">
              {tickets.length === 0
                ? "Create a support ticket if you need help with WorkerMill"
                : "Try adjusting your search or filters"}
            </p>
            {tickets.length === 0 && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Your First Ticket
              </button>
            )}
          </div>
        ) : (
          <div className="bg-card rounded-lg border border-border overflow-hidden">
            <div className="divide-y divide-border">
              {filteredTickets.map((ticket) => (
                <Link
                  key={ticket.id}
                  to={`/support/${ticket.ticketKey}`}
                  className="block p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    {/* Category Icon */}
                    <div className="p-2 bg-muted rounded-lg text-muted-foreground shrink-0">
                      {CATEGORY_ICONS[ticket.category] || <HelpCircle className="w-4 h-4" />}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm text-muted-foreground">
                          {ticket.ticketKey}
                        </span>
                        <TicketStatusBadge status={ticket.status} />
                        <TicketPriorityBadge priority={ticket.priority} />
                      </div>
                      <h3 className="font-medium text-foreground truncate">
                        {ticket.subject}
                      </h3>
                      <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {formatDate(ticket.createdAt)}
                        </span>
                        <span className="capitalize">
                          {CATEGORY_LABELS[ticket.category] || ticket.category}
                        </span>
                      </div>
                    </div>

                    {/* Arrow */}
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Total count */}
        {!loading && !error && filteredTickets.length > 0 && (
          <p className="text-sm text-muted-foreground mt-4 text-center">
            Showing {filteredTickets.length} of {total} tickets
          </p>
        )}
      </main>

      {/* Create Ticket Modal */}
      <CreateTicketModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleTicketCreated}
      />
    </div>
  );
}
