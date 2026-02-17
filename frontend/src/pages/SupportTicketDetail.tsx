import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Send,
  Loader2,
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  User,
  MessageSquare,
  Lock,
  HelpCircle,
  Bug,
  CreditCard,
  Lightbulb,
  Wrench,
  MoreVertical,
} from "lucide-react";
import { useAuthStore } from "../store/auth-store";
import { useToast } from "../contexts/ToastContext";
import { TicketStatusBadge } from "../components/support/TicketStatusBadge";
import { TicketPriorityBadge } from "../components/support/TicketPriorityBadge";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface TicketMessage {
  id: string;
  content: string;
  isInternal: boolean;
  isFromSupport: boolean;
  author: { id: string; email: string; fullName: string | null } | null;
  authorEmail: string | null;
  displayAuthor: string;
  attachments: Array<{ name: string; url: string; size: number }> | null;
  createdAt: string;
}

interface SupportTicket {
  id: string;
  ticketKey: string;
  subject: string;
  description: string;
  status: string;
  statusDisplay: string;
  priority: string;
  category: string;
  createdBy: { id: string; email: string; fullName: string | null } | null;
  assignedTo: { id: string; email: string; fullName: string | null } | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  general: <HelpCircle className="w-5 h-5" />,
  billing: <CreditCard className="w-5 h-5" />,
  technical: <Wrench className="w-5 h-5" />,
  feature_request: <Lightbulb className="w-5 h-5" />,
  bug_report: <Bug className="w-5 h-5" />,
};

const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  billing: "Billing",
  technical: "Technical",
  feature_request: "Feature Request",
  bug_report: "Bug Report",
};

// Users with support admin privileges (can see internal notes, change status, etc.)
const SUPPORT_ADMIN_EMAILS = [
  "support@workermill.com",
];

export default function SupportTicketDetail() {
  const { ticketKey } = useParams<{ ticketKey: string }>();
  const navigate = useNavigate();
  const tokens = useAuthStore((state) => state.tokens);
  const user = useAuthStore((state) => state.user);
  const { success, error: showError } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Support admin can see internal notes, change status, etc.
  // Regular users can view their own tickets (access controlled by backend)
  const _isSupportAdmin = user?.email && SUPPORT_ADMIN_EMAILS.includes(user.email);

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reply state
  const [replyContent, setReplyContent] = useState("");
  const [sending, setSending] = useState(false);

  // Status update
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  const fetchTicket = useCallback(async () => {
    if (!tokens?.accessToken || !ticketKey) return;

    try {
      setLoading(true);
      setError(null);

      // First get ticket ID from ticketKey by listing tickets
      const listRes = await fetch(`${API_BASE}/api/support/tickets?limit=100`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });

      if (!listRes.ok) {
        throw new Error("Failed to fetch tickets");
      }

      const listData = await listRes.json();
      const foundTicket = listData.tickets.find(
        (t: SupportTicket) => t.ticketKey === ticketKey
      );

      if (!foundTicket) {
        throw new Error("Ticket not found");
      }

      // Fetch full ticket details with messages
      const res = await fetch(`${API_BASE}/api/support/tickets/${foundTicket.id}`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });

      if (!res.ok) {
        throw new Error("Failed to fetch ticket details");
      }

      const data = await res.json();
      setTicket(data.ticket);
      setMessages(data.messages);
    } catch (err) {
      console.error("Failed to fetch ticket:", err);
      setError(err instanceof Error ? err.message : "Failed to load ticket");
    } finally {
      setLoading(false);
    }
  }, [tokens?.accessToken, ticketKey]);

  useEffect(() => {
    fetchTicket();
  }, [fetchTicket]);

  useEffect(() => {
    // Scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokens?.accessToken || !ticket || !replyContent.trim()) return;

    try {
      setSending(true);

      const res = await fetch(`${API_BASE}/api/support/tickets/${ticket.id}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        body: JSON.stringify({ content: replyContent.trim() }),
      });

      if (!res.ok) {
        throw new Error("Failed to send message");
      }

      const data = await res.json();
      setMessages([...messages, { ...data.message, author: user, displayAuthor: user?.fullName || user?.email || "You" }]);
      setReplyContent("");
      success("Message sent successfully");
    } catch (err) {
      console.error("Failed to send reply:", err);
      showError("Failed to send message. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!tokens?.accessToken || !ticket) return;

    try {
      setUpdatingStatus(true);
      setShowStatusMenu(false);

      const res = await fetch(`${API_BASE}/api/support/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to update status");
      }

      const data = await res.json();
      setTicket({ ...ticket, status: data.ticket.status, statusDisplay: data.ticket.statusDisplay });
      success(newStatus === "closed" ? "Ticket closed" : "Ticket reopened");
    } catch (err) {
      console.error("Failed to update status:", err);
      showError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const formatRelativeDate = (dateStr: string) => {
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

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 bg-card border-b border-border">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center h-16">
              <Link
                to="/support"
                className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-muted-foreground" />
              </Link>
              <span className="ml-4 text-lg font-medium text-foreground">Support</span>
            </div>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6 text-center">
            <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
            <p className="text-destructive">{error || "Ticket not found"}</p>
            <button
              onClick={() => navigate("/support")}
              className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Back to Support
            </button>
          </div>
        </main>
      </div>
    );
  }

  const isOpen = !["resolved", "closed"].includes(ticket.status);
  const canClose = user?.role === "admin" || ticket.createdBy?.id === user?.id;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link
                to="/support"
                className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-muted-foreground" />
              </Link>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">
                  {ticket.ticketKey}
                </span>
                <TicketStatusBadge status={ticket.status} />
                <TicketPriorityBadge priority={ticket.priority} />
              </div>
            </div>

            {/* Status Actions */}
            {canClose && (
              <div className="relative">
                <button
                  onClick={() => setShowStatusMenu(!showStatusMenu)}
                  disabled={updatingStatus}
                  className="p-2 rounded-lg hover:bg-muted transition-colors"
                >
                  {updatingStatus ? (
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  ) : (
                    <MoreVertical className="w-5 h-5 text-muted-foreground" />
                  )}
                </button>

                {showStatusMenu && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-card border border-border rounded-lg shadow-lg py-1 z-50">
                    {isOpen ? (
                      <button
                        onClick={() => handleStatusChange("closed")}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                      >
                        <XCircle className="w-4 h-4 text-muted-foreground" />
                        Close Ticket
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStatusChange("open")}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                      >
                        <MessageSquare className="w-4 h-4 text-muted-foreground" />
                        Reopen Ticket
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col max-w-4xl w-full mx-auto">
        {/* Ticket Info */}
        <div className="px-4 sm:px-6 lg:px-8 py-6 border-b border-border bg-card">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-muted rounded-lg text-muted-foreground shrink-0">
              {CATEGORY_ICONS[ticket.category] || <HelpCircle className="w-5 h-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-semibold text-foreground mb-2">
                {ticket.subject}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  Created {formatRelativeDate(ticket.createdAt)}
                </span>
                <span className="capitalize">
                  {CATEGORY_LABELS[ticket.category] || ticket.category}
                </span>
                {ticket.createdBy && (
                  <span className="flex items-center gap-1">
                    <User className="w-3.5 h-3.5" />
                    {ticket.createdBy.fullName || ticket.createdBy.email}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          {/* Original Description */}
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-foreground">
                  {ticket.createdBy?.fullName || ticket.createdBy?.email || "You"}
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatDate(ticket.createdAt)}
                </span>
              </div>
              <div className="bg-muted/50 rounded-lg p-4 text-sm text-foreground whitespace-pre-wrap">
                {ticket.description}
              </div>
            </div>
          </div>

          {/* Message Thread */}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-4 ${message.isInternal ? "opacity-70" : ""}`}
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  message.isFromSupport
                    ? "bg-blue-500/10"
                    : "bg-primary/10"
                }`}
              >
                {message.isInternal ? (
                  <Lock className="w-5 h-5 text-muted-foreground" />
                ) : message.isFromSupport ? (
                  <MessageSquare className="w-5 h-5 text-blue-500" />
                ) : (
                  <User className="w-5 h-5 text-primary" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-foreground">
                    {message.displayAuthor}
                  </span>
                  {message.isFromSupport && (
                    <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded-full">
                      Support
                    </span>
                  )}
                  {message.isInternal && (
                    <span className="text-xs px-2 py-0.5 bg-muted text-muted-foreground rounded-full">
                      Internal Note
                    </span>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {formatDate(message.createdAt)}
                  </span>
                </div>
                <div
                  className={`rounded-lg p-4 text-sm whitespace-pre-wrap ${
                    message.isFromSupport
                      ? "bg-blue-500/5 border border-blue-500/10 text-foreground"
                      : "bg-muted/50 text-foreground"
                  }`}
                >
                  {message.content}
                </div>
              </div>
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        {/* Reply Input */}
        {isOpen && (
          <div className="border-t border-border bg-card px-4 sm:px-6 lg:px-8 py-4">
            <form onSubmit={handleSendReply} className="flex gap-4">
              <textarea
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder="Type your reply..."
                rows={3}
                className="flex-1 px-4 py-3 bg-muted/50 border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                type="submit"
                disabled={!replyContent.trim() || sending}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-end"
              >
                {sending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </form>
          </div>
        )}

        {/* Closed Banner */}
        {!isOpen && (
          <div className="border-t border-border bg-muted/50 px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              {ticket.status === "resolved" ? (
                <>
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span>This ticket has been resolved</span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5" />
                  <span>This ticket is closed</span>
                </>
              )}
              {canClose && (
                <button
                  onClick={() => handleStatusChange("open")}
                  className="ml-4 text-sm text-primary hover:underline"
                >
                  Reopen
                </button>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
