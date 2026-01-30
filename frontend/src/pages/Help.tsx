import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  MessageSquare,
  Clock,
  AlertCircle,
  Loader2,
  ChevronRight,
  HelpCircle,
  Bug,
  CreditCard,
  Lightbulb,
  Wrench,
  Bot,
  Sparkles,
  BookOpen,
  ExternalLink,
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
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
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

export default function Help() {
  const tokens = useAuthStore((state) => state.tokens);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchTickets = useCallback(async () => {
    if (!tokens?.accessToken) return;

    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`${API_BASE}/api/support/tickets?limit=20`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });

      if (!res.ok) {
        throw new Error("Failed to fetch tickets");
      }

      const data = await res.json();
      setTickets(data.tickets);
    } catch (err) {
      console.error("Failed to fetch tickets:", err);
      setError("Failed to load your support tickets");
    } finally {
      setLoading(false);
    }
  }, [tokens?.accessToken]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleTicketCreated = () => {
    setShowCreateModal(false);
    fetchTickets();
  };

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

  // Count active tickets
  const activeTickets = tickets.filter(
    (t) => !["resolved", "closed"].includes(t.status)
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link
                to="/dashboard"
                className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-muted-foreground" />
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-foreground">Help & Support</h1>
                <p className="text-sm text-muted-foreground">
                  Get assistance with WorkerMill
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Request
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* AI Support Banner */}
        <div className="bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 rounded-xl border border-primary/20 p-6 mb-8">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-primary/20 rounded-xl">
              <Bot className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-semibold text-foreground">AI-Powered Support</h2>
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Our AI support agent will automatically respond to your requests within minutes.
                For complex issues, a human support team member will follow up.
              </p>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  Available 24/7
                </span>
                <span className="text-muted-foreground">
                  Average response time: &lt; 5 minutes
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <a
            href="/docs"
            className="flex items-center gap-3 p-4 bg-card rounded-xl border border-border hover:border-primary/50 hover:bg-muted/50 transition-all group"
          >
            <div className="p-2.5 bg-blue-500/10 rounded-lg text-blue-500 group-hover:bg-blue-500/20 transition-colors">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="font-medium text-foreground">Documentation</div>
              <div className="text-sm text-muted-foreground">Browse guides & tutorials</div>
            </div>
          </a>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-3 p-4 bg-card rounded-xl border border-border hover:border-primary/50 hover:bg-muted/50 transition-all group text-left"
          >
            <div className="p-2.5 bg-primary/10 rounded-lg text-primary group-hover:bg-primary/20 transition-colors">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <div className="font-medium text-foreground">Contact Support</div>
              <div className="text-sm text-muted-foreground">Submit a support request</div>
            </div>
          </button>
          <a
            href="https://github.com/jarod-rosenthal/workermill/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 bg-card rounded-xl border border-border hover:border-primary/50 hover:bg-muted/50 transition-all group"
          >
            <div className="p-2.5 bg-orange-500/10 rounded-lg text-orange-500 group-hover:bg-orange-500/20 transition-colors">
              <Bug className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                Report a Bug
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div className="text-sm text-muted-foreground">Open a GitHub issue</div>
            </div>
          </a>
        </div>

        {/* Your Tickets */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">
              Your Support Requests
              {activeTickets.length > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full">
                  {activeTickets.length} active
                </span>
              )}
            </h2>
          </div>

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
          ) : tickets.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-12 text-center">
              <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                No support requests yet
              </h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Need help with WorkerMill? Create a support request and our AI-powered
                support agent will assist you right away.
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Your First Request
              </button>
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="divide-y divide-border">
                {tickets.map((ticket) => (
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
        </div>
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
