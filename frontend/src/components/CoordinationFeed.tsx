import { useEffect, useRef, useState, useCallback } from "react";
import {
  MessageSquare,
  FileText,
  FileEdit,
  GitBranch,
  HelpCircle,
  MessageCircle,
  CheckCircle,
  AlertTriangle,
  AlertOctagon,
  Activity,
  Filter,
  ChevronLeft,
  Wifi,
  WifiOff,
  Send,
  Folder,
  PanelRightClose,
} from "lucide-react";
import {
  useCoordinationStore,
  type ContextMessage,
  type ContextMessageType,
} from "../store/coordination-store";

const API_BASE = import.meta.env.VITE_API_URL || "";

// Persona config for display
const PERSONA_CONFIGS: Record<string, { emoji: string; shortLabel: string }> = {
  frontend_developer: { emoji: "🎨", shortLabel: "Frontend" },
  backend_developer: { emoji: "⚙️", shortLabel: "Backend" },
  devops_engineer: { emoji: "🔧", shortLabel: "DevOps" },
  security_engineer: { emoji: "🔒", shortLabel: "Security" },
  qa_engineer: { emoji: "🧪", shortLabel: "QA" },
  tech_writer: { emoji: "📝", shortLabel: "Docs" },
  project_manager: { emoji: "📋", shortLabel: "PM" },
  api_developer: { emoji: "🔌", shortLabel: "API" },
  database_administrator: { emoji: "🗄️", shortLabel: "DBA" },
  ml_engineer: { emoji: "🤖", shortLabel: "ML" },
  mobile_developer_ios: { emoji: "📱", shortLabel: "iOS" },
  mobile_developer_android: { emoji: "🤖", shortLabel: "Android" },
  manager: { emoji: "👔", shortLabel: "Manager" },
};

// Message type config with enhanced icons
const MESSAGE_TYPE_CONFIG: Record<
  ContextMessageType,
  { icon: React.ElementType; emoji: string; color: string; label: string }
> = {
  file_created: {
    icon: FileText,
    emoji: "📁",
    color: "text-green-500",
    label: "Created",
  },
  file_modified: {
    icon: FileEdit,
    emoji: "📝",
    color: "text-blue-500",
    label: "Modified",
  },
  decision: {
    icon: GitBranch,
    emoji: "🔀",
    color: "text-cyan-500",
    label: "Decision",
  },
  dependency: {
    icon: Folder,
    emoji: "📋",
    color: "text-yellow-500",
    label: "Reading",
  },
  question: {
    icon: HelpCircle,
    emoji: "❓",
    color: "text-yellow-500",
    label: "Question",
  },
  answer: {
    icon: MessageCircle,
    emoji: "💬",
    color: "text-blue-500",
    label: "Answer",
  },
  completion: {
    icon: CheckCircle,
    emoji: "✅",
    color: "text-green-500",
    label: "Complete",
  },
  blocker: {
    icon: AlertOctagon,
    emoji: "🚫",
    color: "text-red-500",
    label: "Blocker",
  },
  warning: {
    icon: AlertTriangle,
    emoji: "⚠️",
    color: "text-yellow-500",
    label: "Warning",
  },
  progress: {
    icon: Activity,
    emoji: "📊",
    color: "text-muted-foreground",
    label: "Progress",
  },
};

const FILTER_OPTIONS: Array<{ value: ContextMessageType | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "file_created", label: "Created" },
  { value: "file_modified", label: "Modified" },
  { value: "question", label: "Questions" },
  { value: "completion", label: "Complete" },
  { value: "blocker", label: "Blockers" },
  { value: "warning", label: "Warnings" },
];

// Format timestamp
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// Question message component with inline answer
function QuestionMessage({
  message,
  onAnswer,
}: {
  message: ContextMessage;
  onAnswer?: (answer: string) => void;
}) {
  const [isAnswering, setIsAnswering] = useState(false);
  const [answerText, setAnswerText] = useState("");
  const personaConfig = PERSONA_CONFIGS[message.persona];

  const handleSubmitAnswer = () => {
    if (answerText.trim() && onAnswer) {
      onAnswer(answerText.trim());
      setAnswerText("");
      setIsAnswering(false);
    }
  };

  // Extract suggested answers from metadata if present
  const suggestedAnswers = (message.metadata?.suggestedAnswers as string[]) || [];

  return (
    <div className="p-3 border-b border-border/30 bg-yellow-500/5">
      {/* Header: Time + Persona */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-muted-foreground font-mono">
          {formatTime(message.createdAt)}
        </span>
        <span className="text-xs text-yellow-500 font-medium">
          ⚠️ {personaConfig?.shortLabel || message.persona}
        </span>
      </div>

      {/* Message Card */}
      <div className="bg-muted/50 border border-border/50 rounded-md p-3">
        <div className="flex items-start gap-2">
          <span className="text-yellow-500">❓</span>
          <div className="flex-1">
            <span className="text-sm text-foreground font-medium">
              QUESTION:
            </span>
            <p className="text-sm text-muted-foreground mt-1">
              {message.content}
            </p>
          </div>
        </div>

        {/* Answer Buttons */}
        {!isAnswering && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {suggestedAnswers.map((answer, idx) => (
              <button
                key={idx}
                onClick={() => onAnswer?.(answer)}
                className="px-3 py-1 text-xs font-medium bg-muted border border-border rounded hover:bg-muted/80 hover:border-primary/50 transition-colors"
              >
                {answer}
              </button>
            ))}
            <button
              onClick={() => setIsAnswering(true)}
              className="px-3 py-1 text-xs font-medium text-primary bg-transparent border border-primary rounded hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              Answer...
            </button>
          </div>
        )}

        {/* Custom Answer Input */}
        {isAnswering && (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmitAnswer()}
                placeholder="Type your answer..."
                className="flex-1 px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:border-primary"
                autoFocus
              />
              <button
                onClick={handleSubmitAnswer}
                disabled={!answerText.trim()}
                className="p-1.5 text-primary hover:bg-muted rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setIsAnswering(false);
                  setAnswerText("");
                }}
                className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Standard message component with card style
function FeedMessage({ message }: { message: ContextMessage }) {
  const config = MESSAGE_TYPE_CONFIG[message.messageType];
  const personaConfig = PERSONA_CONFIGS[message.persona];

  return (
    <div className="p-3 border-b border-border/30 hover:bg-muted/30 transition-colors">
      {/* Header: Time + Persona */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-muted-foreground font-mono">
          {formatTime(message.createdAt)}
        </span>
        <span className={`text-xs ${config?.color || "text-muted-foreground"}`}>
          {personaConfig?.emoji || "?"} {personaConfig?.shortLabel || message.persona}
        </span>
      </div>

      {/* Message Card */}
      <div className="bg-muted/30 border border-border/30 rounded-md p-2.5">
        <div className="flex items-start gap-2">
          <span className={config?.color || "text-muted-foreground"}>
            {config?.emoji || "💬"}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground">
              {message.content}
            </p>

            {/* File path metadata */}
            {typeof message.metadata?.filePath === "string" && (
              <code className="block mt-1 text-xs text-cyan-400 bg-black/30 px-1.5 py-0.5 rounded">
                {message.metadata.filePath}
              </code>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface CoordinationFeedProps {
  parentTaskId: string | null;
  onAnswerQuestion?: (messageId: string, answer: string) => void;
}

export function CoordinationFeed({ parentTaskId, onAnswerQuestion }: CoordinationFeedProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Use stable selectors to avoid infinite loops
  const messages = useCoordinationStore((s) => s.messages);
  const isConnected = useCoordinationStore((s) => s.isConnected);
  const isCollapsed = useCoordinationStore((s) => s.isCollapsed);
  const filterType = useCoordinationStore((s) => s.filterType);

  // Get stable action references
  const addMessage = useCoordinationStore((s) => s.addMessage);
  const setConnected = useCoordinationStore((s) => s.setConnected);
  const setFilterType = useCoordinationStore((s) => s.setFilterType);
  const toggleCollapsed = useCoordinationStore((s) => s.toggleCollapsed);
  const clearMessages = useCoordinationStore((s) => s.clearMessages);

  // Filter messages
  const filteredMessages =
    filterType === "all"
      ? messages
      : messages.filter((m) => m.messageType === filterType);

  // Check if scrolled to bottom
  const isAtBottom = () => {
    const el = feedRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (wasAtBottomRef.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
      setHasNewMessages(false);
    } else if (!wasAtBottomRef.current) {
      setHasNewMessages(true);
    }
  }, [messages]);

  const handleScroll = () => {
    wasAtBottomRef.current = isAtBottom();
    if (wasAtBottomRef.current) {
      setHasNewMessages(false);
    }
  };

  const scrollToBottom = () => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
      setHasNewMessages(false);
    }
  };

  // SSE connection using stable callbacks
  const connectStream = useCallback(() => {
    if (!parentTaskId) return;

    const token = localStorage.getItem("accessToken");
    if (!token) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `${API_BASE}/api/coordination/context/${parentTaskId}/stream?token=${encodeURIComponent(token)}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setConnected(true);
    };

    eventSource.addEventListener("context", (event) => {
      try {
        const msg = JSON.parse(event.data) as ContextMessage;
        addMessage(msg);
      } catch (err) {
        console.error("Failed to parse context message:", err);
      }
    });

    eventSource.onerror = () => {
      setConnected(false);
      // EventSource will auto-reconnect
    };
  }, [parentTaskId, addMessage, setConnected]);

  // Connect/disconnect based on parentTaskId
  useEffect(() => {
    if (parentTaskId && !isCollapsed) {
      connectStream();
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [parentTaskId, isCollapsed, connectStream]);

  // Clear messages when parentTaskId changes
  useEffect(() => {
    clearMessages();
  }, [parentTaskId, clearMessages]);

  const handleReconnect = () => {
    connectStream();
  };

  // Don't render if no parent task
  if (!parentTaskId) {
    return null;
  }

  // Collapsed state - just show toggle button
  if (isCollapsed) {
    return (
      <aside className="w-12 flex-shrink-0 border-l border-border/30 bg-background/50 transition-all duration-300 relative">
        <button
          onClick={toggleCollapsed}
          className="absolute -left-3 top-4 z-10 p-1.5 rounded-full bg-muted border border-border hover:bg-muted/80 transition-colors"
          title="Expand Coordination Feed"
        >
          <ChevronLeft className="w-3 h-3" />
        </button>
        <div className="p-2 pt-12 space-y-3">
          <div className="p-2 rounded bg-primary/10 text-center" title="Coordination Feed">
            <MessageSquare className="w-4 h-4 mx-auto text-primary" />
          </div>
          {messages.length > 0 && (
            <div className="text-center">
              <span className="text-xs font-bold text-primary">{messages.length}</span>
            </div>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-80 flex-shrink-0 border-l border-border/30 bg-background/50 transition-all duration-300 relative flex flex-col">
      <button
        onClick={toggleCollapsed}
        className="absolute -left-3 top-4 z-10 p-1.5 rounded-full bg-muted border border-border hover:bg-muted/80 transition-colors"
        title="Collapse Coordination Feed"
      >
        <PanelRightClose className="w-3 h-3" />
      </button>

      {/* Header */}
      <div className="p-3 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Coordination</span>
          {messages.length > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium rounded-full bg-primary/20 text-primary">
              {messages.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Connection Status */}
          {isConnected ? (
            <Wifi className="w-3 h-3 text-green-500" />
          ) : (
            <button
              onClick={handleReconnect}
              className="flex items-center gap-1 text-red-500 hover:underline"
              title="Click to reconnect"
            >
              <WifiOff className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Filter Dropdown */}
      <div className="px-3 py-2 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Filter className="w-3 h-3 text-muted-foreground" />
          <select
            value={filterType}
            onChange={(e) =>
              setFilterType(e.target.value as ContextMessageType | "all")
            }
            className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs text-muted-foreground focus:outline-none focus:border-primary"
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Message List */}
      <div
        ref={feedRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto relative"
      >
        {filteredMessages.length === 0 ? (
          <div className="p-8 text-center">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No messages yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Coordination messages from workers will appear here
            </p>
          </div>
        ) : (
          filteredMessages.map((msg) =>
            msg.messageType === "question" ? (
              <QuestionMessage
                key={msg.id}
                message={msg}
                onAnswer={(answer) => onAnswerQuestion?.(msg.id, answer)}
              />
            ) : (
              <FeedMessage key={msg.id} message={msg} />
            )
          )
        )}

        {/* New Messages Indicator */}
        {hasNewMessages && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-colors"
          >
            New messages ↓
          </button>
        )}
      </div>
    </aside>
  );
}
