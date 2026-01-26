import { useEffect, useRef, useState } from "react";
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
  ChevronRight,
  ChevronLeft,
  Wifi,
  WifiOff,
  Send,
  Folder,
} from "lucide-react";
import type { ContextMessage, ContextMessageType } from "../orchestration-store";
import { PERSONA_CONFIGS } from "../../../types/mission-control";

interface CoordinationFeedProps {
  messages: ContextMessage[];
  filterType: ContextMessageType | "all";
  isCollapsed: boolean;
  isConnected: boolean;
  onFilterChange: (filter: ContextMessageType | "all") => void;
  onToggleCollapse: () => void;
  onReconnect: () => void;
  onAnswerQuestion?: (messageId: string, answer: string) => void;
}

// Message type config with enhanced icons
const MESSAGE_TYPE_CONFIG: Record<
  ContextMessageType,
  { icon: React.ElementType; emoji: string; color: string; label: string }
> = {
  file_created: {
    icon: FileText,
    emoji: "📁",
    color: "var(--mc-status-live)",
    label: "Created",
  },
  file_modified: {
    icon: FileEdit,
    emoji: "📝",
    color: "var(--mc-status-active)",
    label: "Modified",
  },
  decision: {
    icon: GitBranch,
    emoji: "🔀",
    color: "var(--mc-status-info)",
    label: "Decision",
  },
  dependency: {
    icon: Folder,
    emoji: "📋",
    color: "var(--mc-status-warning)",
    label: "Reading",
  },
  question: {
    icon: HelpCircle,
    emoji: "❓",
    color: "var(--mc-status-warning)",
    label: "Question",
  },
  answer: {
    icon: MessageCircle,
    emoji: "💬",
    color: "var(--mc-status-active)",
    label: "Answer",
  },
  completion: {
    icon: CheckCircle,
    emoji: "✅",
    color: "var(--mc-status-live)",
    label: "Complete",
  },
  blocker: {
    icon: AlertOctagon,
    emoji: "🚫",
    color: "var(--mc-status-danger)",
    label: "Blocker",
  },
  warning: {
    icon: AlertTriangle,
    emoji: "⚠️",
    color: "var(--mc-status-warning)",
    label: "Warning",
  },
  progress: {
    icon: Activity,
    emoji: "📊",
    color: "var(--mc-text-muted)",
    label: "Progress",
  },
  story_ready: {
    icon: CheckCircle,
    emoji: "🎯",
    color: "var(--mc-status-info)",
    label: "Ready",
  },
  story_claimed: {
    icon: Activity,
    emoji: "🏃",
    color: "var(--mc-status-active)",
    label: "Claimed",
  },
  consultation: {
    icon: HelpCircle,
    emoji: "🤝",
    color: "var(--mc-status-warning)",
    label: "Consult",
  },
  constraints: {
    icon: FileText,
    emoji: "📋",
    color: "var(--mc-text-muted)",
    label: "Constraints",
  },
  revision_requested: {
    icon: AlertTriangle,
    emoji: "🔄",
    color: "var(--mc-status-warning)",
    label: "Revision",
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
  const personaConfig = PERSONA_CONFIGS[message.persona as keyof typeof PERSONA_CONFIGS];

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
    <div className="p-3 border-b border-[var(--mc-border-subtle)] bg-[rgba(255,170,0,0.05)]">
      {/* Header: Time + Persona */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] font-mono">
          {formatTime(message.createdAt)}
        </span>
        <span className="text-[var(--mc-text-xs)] text-[var(--mc-status-warning)] font-medium">
          ⚠️ {personaConfig?.shortLabel || message.persona}
        </span>
      </div>

      {/* Message Card */}
      <div className="bg-[var(--mc-bg-elevated)] border border-[var(--mc-border-default)] rounded-md p-3">
        <div className="flex items-start gap-2">
          <span className="text-[var(--mc-status-warning)]">❓</span>
          <div className="flex-1">
            <span className="text-[var(--mc-text-sm)] text-[var(--mc-text-primary)] font-medium">
              QUESTION:
            </span>
            <p className="text-[var(--mc-text-sm)] text-[var(--mc-text-secondary)] mt-1">
              {message.content}
            </p>
          </div>
        </div>

        {/* Answer Buttons */}
        {!isAnswering && (
          <div className="flex items-center gap-2 mt-3">
            {suggestedAnswers.map((answer, idx) => (
              <button
                key={idx}
                onClick={() => onAnswer?.(answer)}
                className="px-3 py-1 text-[var(--mc-text-xs)] font-medium bg-[var(--mc-bg-hover)] border border-[var(--mc-border-default)] rounded hover:bg-[var(--mc-bg-active)] hover:border-[var(--mc-status-active)] transition-colors"
              >
                {answer}
              </button>
            ))}
            <button
              onClick={() => setIsAnswering(true)}
              className="px-3 py-1 text-[var(--mc-text-xs)] font-medium text-[var(--mc-status-active)] bg-transparent border border-[var(--mc-status-active)] rounded hover:bg-[var(--mc-status-active)] hover:text-[var(--mc-bg-void)] transition-colors"
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
                className="flex-1 px-3 py-1.5 text-[var(--mc-text-sm)] bg-[var(--mc-bg-surface)] border border-[var(--mc-border-default)] rounded focus:outline-none focus:border-[var(--mc-status-active)]"
                autoFocus
              />
              <button
                onClick={handleSubmitAnswer}
                disabled={!answerText.trim()}
                className="p-1.5 text-[var(--mc-status-active)] hover:bg-[var(--mc-bg-hover)] rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setIsAnswering(false);
                  setAnswerText("");
                }}
                className="px-2 py-1 text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] hover:text-[var(--mc-text-primary)]"
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
  const personaConfig = PERSONA_CONFIGS[message.persona as keyof typeof PERSONA_CONFIGS];

  return (
    <div className="p-3 border-b border-[var(--mc-border-subtle)] hover:bg-[var(--mc-bg-hover)] transition-colors">
      {/* Header: Time + Persona */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[var(--mc-text-xs)] text-[var(--mc-text-muted)] font-mono">
          {formatTime(message.createdAt)}
        </span>
        <span className="text-[var(--mc-text-xs)]" style={{ color: config?.color }}>
          {personaConfig?.emoji || "?"} {personaConfig?.shortLabel || message.persona}
        </span>
      </div>

      {/* Message Card */}
      <div className="bg-[var(--mc-bg-elevated)] border border-[var(--mc-border-subtle)] rounded-md p-2.5">
        <div className="flex items-start gap-2">
          <span style={{ color: config?.color }}>{config?.emoji || "💬"}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[var(--mc-text-sm)] text-[var(--mc-text-secondary)]">
              {message.content}
            </p>

            {/* File path metadata */}
            {typeof message.metadata?.filePath === "string" && (
              <code className="block mt-1 text-[var(--mc-text-xs)] text-[var(--mc-terminal-text)] bg-[var(--mc-terminal-bg)] px-1.5 py-0.5 rounded">
                {message.metadata.filePath}
              </code>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CoordinationFeed({
  messages,
  filterType,
  isCollapsed,
  isConnected,
  onFilterChange,
  onToggleCollapse,
  onReconnect,
  onAnswerQuestion,
}: CoordinationFeedProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);

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

  // Collapsed state - just show toggle button
  if (isCollapsed) {
    return (
      <div className="flex flex-col h-full">
        <button
          onClick={onToggleCollapse}
          className="mc-btn mc-btn-ghost p-2 flex items-center justify-center"
          title="Expand Coordination Feed"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="mc-triage-rail h-full flex flex-col">
      {/* Header */}
      <div className="mc-triage-header">
        <div className="flex items-center gap-2">
          <span className="mc-triage-title">Coordination Feed</span>
          {messages.length > 0 && (
            <span className="mc-triage-count">{messages.length}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Connection Status */}
          {isConnected ? (
            <Wifi className="w-3 h-3 text-[var(--mc-status-live)]" />
          ) : (
            <button
              onClick={onReconnect}
              className="flex items-center gap-1 text-[var(--mc-status-danger)] hover:underline"
              title="Click to reconnect"
            >
              <WifiOff className="w-3 h-3" />
            </button>
          )}

          {/* Collapse Button */}
          <button
            onClick={onToggleCollapse}
            className="mc-btn mc-btn-ghost p-1"
            title="Collapse Feed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter Dropdown */}
      <div className="px-3 py-2 border-b border-[var(--mc-border-subtle)]">
        <div className="flex items-center gap-2">
          <Filter className="w-3 h-3 text-[var(--mc-text-muted)]" />
          <select
            value={filterType}
            onChange={(e) =>
              onFilterChange(e.target.value as ContextMessageType | "all")
            }
            className="flex-1 bg-[var(--mc-bg-elevated)] border border-[var(--mc-border-default)] rounded px-2 py-1 text-[var(--mc-text-xs)] text-[var(--mc-text-secondary)] focus:outline-none focus:border-[var(--mc-status-active)]"
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
        {messages.length === 0 ? (
          <div className="mc-empty py-8">
            <div className="mc-empty-icon">
              <MessageSquare />
            </div>
            <div className="mc-empty-title">No messages yet</div>
            <div className="mc-empty-desc">
              Coordination messages from workers will appear here
            </div>
          </div>
        ) : (
          messages.map((msg) =>
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
            className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 text-[var(--mc-text-xs)] font-medium bg-[var(--mc-status-active)] text-[var(--mc-bg-void)] rounded-full shadow-lg hover:bg-[#00b8e0] transition-colors"
          >
            New messages ↓
          </button>
        )}
      </div>
    </div>
  );
}
