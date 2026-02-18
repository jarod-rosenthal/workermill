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
  BookOpen,
  UserCheck,
  Trash2,
} from "lucide-react";
import {
  useCoordinationStore,
  type ContextMessage,
  type ContextMessageType,
} from "../store/coordination-store";
import { useToast } from "../contexts/ToastContext";

const API_BASE = import.meta.env.VITE_API_URL || "";

// Persona config for display
const PERSONA_CONFIGS: Record<string, { emoji: string; shortLabel: string }> = {
  frontend_developer: { emoji: "🎨", shortLabel: "Frontend" },
  backend_developer: { emoji: "💻", shortLabel: "Backend" },
  devops_engineer: { emoji: "🔧", shortLabel: "DevOps" },
  security_engineer: { emoji: "🔒", shortLabel: "Security" },
  qa_engineer: { emoji: "🧪", shortLabel: "QA" },
  tech_writer: { emoji: "📝", shortLabel: "Docs" },
  project_manager: { emoji: "📋", shortLabel: "PM" },
  api_developer: { emoji: "🔌", shortLabel: "API" },
  database_administrator: { emoji: "💾", shortLabel: "DBA" },
  ml_engineer: { emoji: "🤖", shortLabel: "ML" },
  mobile_developer_ios: { emoji: "📱", shortLabel: "iOS" },
  mobile_developer_android: { emoji: "🤖", shortLabel: "Android" },
  tech_lead: { emoji: "👑", shortLabel: "Tech Lead" },
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
  blocker_detected: {
    icon: AlertOctagon,
    emoji: "🚨",
    color: "text-red-500",
    label: "Blocker Detected",
  },
  blocker_resolved: {
    icon: CheckCircle,
    emoji: "✅",
    color: "text-green-500",
    label: "Blocker Resolved",
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
  story_ready: {
    icon: BookOpen,
    emoji: "📖",
    color: "text-purple-500",
    label: "Story Ready",
  },
  story_claimed: {
    icon: UserCheck,
    emoji: "👤",
    color: "text-cyan-500",
    label: "Story Claimed",
  },
  consultation: {
    icon: MessageCircle,
    emoji: "🤝",
    color: "text-purple-500",
    label: "Consultation",
  },
  constraints: {
    icon: FileText,
    emoji: "📋",
    color: "text-blue-500",
    label: "Constraints",
  },
  revision_requested: {
    icon: AlertTriangle,
    emoji: "🔄",
    color: "text-yellow-500",
    label: "Revision Requested",
  },
  user_message: {
    icon: MessageCircle,
    emoji: "📨",
    color: "text-cyan-500",
    label: "User Message",
  },
  worker_ack: {
    icon: CheckCircle,
    emoji: "✅",
    color: "text-green-500",
    label: "Received",
  },
  expert_response: {
    icon: MessageCircle,
    emoji: "💬",
    color: "text-indigo-500",
    label: "Expert Message",
  },
};

// Filter options for coordination feed
// "important" shows collaboration messages only (decisions, questions, answers, blockers, completions)
// "all" shows everything including progress, file changes, etc.
const FILTER_OPTIONS: Array<{ value: ContextMessageType | "all" | "important"; label: string }> = [
  { value: "important", label: "Important" },
  { value: "all", label: "All Messages" },
  { value: "decision", label: "Decisions" },
  { value: "question", label: "Questions" },
  { value: "answer", label: "Answers" },
  { value: "blocker", label: "Blockers" },
  { value: "completion", label: "Complete" },
  { value: "progress", label: "Progress" },
];

// Parse sessionId to extract persona and story index
// Format: "{persona}-story-{storyIndex}" e.g., "backend_developer-story-1"
function parseSessionId(sessionId: string | undefined): { persona: string; storyIndex: number } | null {
  if (!sessionId) return null;
  const match = sessionId.match(/^(.+)-story-(\d+)$/);
  if (!match) return null;
  return { persona: match[1], storyIndex: parseInt(match[2], 10) };
}

// Group messages by sessionId for threaded view
interface ThreadGroup {
  sessionId: string;
  persona: string;
  storyIndex: number;
  messages: ContextMessage[];
  startedAt: string;
  isComplete: boolean;
}

function groupMessagesBySession(messages: ContextMessage[]): ThreadGroup[] {
  const groups = new Map<string, ThreadGroup>();
  const ungrouped: ContextMessage[] = [];

  for (const msg of messages) {
    const parsed = parseSessionId(msg.sessionId);
    if (parsed && msg.sessionId) {
      let group = groups.get(msg.sessionId);
      if (!group) {
        group = {
          sessionId: msg.sessionId,
          persona: parsed.persona,
          storyIndex: parsed.storyIndex,
          messages: [],
          startedAt: msg.createdAt,
          isComplete: false,
        };
        groups.set(msg.sessionId, group);
      }
      group.messages.push(msg);
      if (msg.messageType === "completion") {
        group.isComplete = true;
      }
    } else {
      ungrouped.push(msg);
    }
  }

  // Sort groups by story index, then by start time
  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    if (a.storyIndex !== b.storyIndex) return a.storyIndex - b.storyIndex;
    return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
  });

  // Add ungrouped messages as a special group at the end if any exist
  if (ungrouped.length > 0) {
    sortedGroups.push({
      sessionId: "ungrouped",
      persona: "system",
      storyIndex: 999,
      messages: ungrouped,
      startedAt: ungrouped[0]?.createdAt || new Date().toISOString(),
      isComplete: false,
    });
  }

  return sortedGroups;
}

// Format timestamp (time only)
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// Format date for date separators
function formatDate(timestamp: string): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return "Today";
  } else if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  } else {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
    });
  }
}

// Get date string for grouping (YYYY-MM-DD)
function getDateKey(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toISOString().split("T")[0];
}

// Clean message content by removing JSON metadata artifacts
// These can leak through from Claude's stream-json output
function cleanMessageContent(content: string): string {
  if (!content) return content;

  let cleaned = content;

  // Remove JSON objects that look like token usage metadata
  // Pattern: {"type":"...", "input_tokens":..., etc}
  cleaned = cleaned.replace(/\{[^{}]*"(?:type|input_tokens|output_tokens|cache_\w+_tokens|stop_reason|stop_sequence)"[^{}]*\}/g, "");

  // Remove standalone JSON-like patterns at the end
  cleaned = cleaned.replace(/\s*\{[^{}]*\}\s*$/g, "");

  // Remove any remaining token-related patterns
  cleaned = cleaned.replace(/\s*"?(?:input_tokens|output_tokens|cache_\w+_input_tokens)"?\s*:\s*\d+,?/g, "");

  // Remove currency/cost metadata patterns
  cleaned = cleaned.replace(/\s*,?\s*"?currency"?\s*:\s*"[A-Z]{3}"\s*,?/gi, "");
  cleaned = cleaned.replace(/\s*,?\s*"?(?:stop_reason|stop_sequence)"?\s*:\s*(?:"[^"]*"|null)\s*,?/gi, "");
  cleaned = cleaned.replace(/\s*,?\s*"?(?:total_cost|estimated_cost)"?\s*:\s*[\d.]+\s*,?/gi, "");

  // Remove service/session metadata
  cleaned = cleaned.replace(/\s*,?\s*"?(?:service|session_id|ephemeral_\w+)"?\s*:\s*"[^"]*"\s*,?/gi, "");

  // Remove cache-related patterns
  cleaned = cleaned.replace(/\s*,?\s*"?Cache_creation[^"]*"?\s*,?/gi, "");
  cleaned = cleaned.replace(/\s*,?\s*"?cache_\w+"?\s*:\s*\d+\s*,?/gi, "");

  // Remove UUID-like patterns that look like leaked IDs (but not in file paths)
  cleaned = cleaned.replace(/\s+"?[0-9a-f]{4,}-[0-9a-f]{4,}[^/\s]*"?\s*/gi, " ");

  // Remove orphaned JSON syntax
  cleaned = cleaned.replace(/^\s*[,:{}\[\]]+\s*/g, "");
  cleaned = cleaned.replace(/\s*[,:{}\[\]]+\s*$/g, "");

  // Clean up multiple spaces, commas, and trim
  cleaned = cleaned.replace(/,\s*,/g, ",");
  cleaned = cleaned.replace(/\s{2,}/g, " ");
  cleaned = cleaned.trim();

  // If the result is just punctuation or empty, return empty
  if (/^[\s,.:;{}[\]]*$/.test(cleaned)) {
    return "";
  }

  return cleaned;
}

// Question message component with inline answer
// Only shows answer UI if the question hasn't been answered yet
function QuestionMessage({
  message,
  onAnswer,
  hasAnswer = false,
}: {
  message: ContextMessage;
  onAnswer?: (answer: string) => void;
  hasAnswer?: boolean; // True if another agent has already answered this question
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

  // Extract questionId for display (format: Q-PERSONA-N)
  const questionId = message.metadata?.questionId as string | undefined;

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
        {hasAnswer && (
          <span className="text-xs text-green-500 font-medium">✓ Answered</span>
        )}
      </div>

      {/* Message Card */}
      <div className="bg-muted/50 border border-border/50 rounded-md p-3">
        <div className="flex items-start gap-2">
          <span className={hasAnswer ? "text-green-500" : "text-yellow-500"}>
            {hasAnswer ? "✅" : "❓"}
          </span>
          <div className="flex-1">
            <span className="text-sm text-foreground font-medium">
              {questionId ? `${questionId}:` : "QUESTION:"}
            </span>
            <p className="text-sm text-muted-foreground mt-1">
              {cleanMessageContent(message.content)}
            </p>
          </div>
        </div>

        {/* Answer Buttons - only show if question hasn't been answered */}
        {!hasAnswer && !isAnswering && onAnswer && (
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
        {!hasAnswer && isAnswering && (
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

// Date separator component
function DateSeparator({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 sticky top-0 bg-background/95 backdrop-blur z-10">
      <div className="flex-1 h-px bg-border/50" />
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {formatDate(date)}
      </span>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}

// Thread group component for threaded view
function ThreadGroupView({
  group,
  onAnswerQuestion,
  showTaskId,
  taskLabels,
  answeredQuestionIds,
}: {
  group: ThreadGroup;
  onAnswerQuestion?: (messageId: string, answer: string) => void;
  showTaskId?: boolean;
  taskLabels?: Record<string, string>;
  answeredQuestionIds: Set<string>; // Set of questionIds that have been answered
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const personaConfig = PERSONA_CONFIGS[group.persona];
  const messageCount = group.messages.length;

  // Check if a question has been answered
  const isQuestionAnswered = (msg: ContextMessage): boolean => {
    const questionId = msg.metadata?.questionId as string | undefined;
    return questionId ? answeredQuestionIds.has(questionId) : false;
  };

  // Don't show ungrouped as a thread, just render messages
  if (group.sessionId === "ungrouped") {
    return (
      <>
        {group.messages.map((msg) =>
          msg.messageType === "question" ? (
            <QuestionMessage
              key={msg.id}
              message={msg}
              onAnswer={(answer) => onAnswerQuestion?.(msg.id, answer)}
              hasAnswer={isQuestionAnswered(msg)}
            />
          ) : (
            <FeedMessage
              key={msg.id}
              message={msg}
              showTaskId={showTaskId}
              taskLabel={msg.parentTaskId ? taskLabels?.[msg.parentTaskId] : undefined}
            />
          )
        )}
      </>
    );
  }

  return (
    <div className="border-b border-border/30">
      {/* Thread Header - Collapsible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3 flex items-center gap-2 hover:bg-muted/30 transition-colors text-left"
      >
        <span className={`text-xs transition-transform ${isExpanded ? "rotate-90" : ""}`}>
          ▶
        </span>
        <span className="text-lg">{personaConfig?.emoji || "🤖"}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              Story {group.storyIndex}
            </span>
            <span className="text-xs text-muted-foreground">
              {personaConfig?.shortLabel || group.persona}
            </span>
            {group.isComplete && (
              <span className="text-xs text-green-500 font-medium">✓ Complete</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {messageCount} message{messageCount !== 1 ? "s" : ""} · {formatTime(group.startedAt)}
          </div>
        </div>
      </button>

      {/* Thread Messages */}
      {isExpanded && (
        <div className="pl-6 border-l-2 border-primary/20 ml-4">
          {group.messages.map((msg) =>
            msg.messageType === "question" ? (
              <QuestionMessage
                key={msg.id}
                message={msg}
                onAnswer={(answer) => onAnswerQuestion?.(msg.id, answer)}
                hasAnswer={isQuestionAnswered(msg)}
              />
            ) : (
              <FeedMessage
                key={msg.id}
                message={msg}
                showTaskId={showTaskId}
                taskLabel={msg.parentTaskId ? taskLabels?.[msg.parentTaskId] : undefined}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

// Standard message component with card style
function FeedMessage({
  message,
  showTaskId = false,
  taskLabel,
}: {
  message: ContextMessage;
  showTaskId?: boolean;
  taskLabel?: string;
}) {
  const config = MESSAGE_TYPE_CONFIG[message.messageType];
  const personaConfig = PERSONA_CONFIGS[message.persona];

  return (
    <div className="p-3 border-b border-border/30 hover:bg-muted/30 transition-colors">
      {/* Header: Time + Task + Persona */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs text-muted-foreground font-mono">
          {formatTime(message.createdAt)}
        </span>
        {showTaskId && taskLabel && (
          <span className="text-xs text-primary/70 font-medium px-1.5 py-0.5 bg-primary/10 rounded">
            {taskLabel}
          </span>
        )}
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
              {cleanMessageContent(message.content)}
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
  taskLabels?: Record<string, string>; // Map of parentTaskId -> display label (e.g., Jira key)
  onAnswerQuestion?: (messageId: string, answer: string) => void;
  isEpicMode?: boolean; // Auto-expand feed for Epic/multi-expert tasks
}

export function CoordinationFeed({ parentTaskId, taskLabels = {}, onAnswerQuestion, isEpicMode = false }: CoordinationFeedProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fetchedTasksRef = useRef<Set<string>>(new Set()); // Track which tasks we've already fetched
  const toast = useToast();

  // Use stable selectors to avoid infinite loops
  const messages = useCoordinationStore((s) => s.messages);
  const isConnected = useCoordinationStore((s) => s.isConnected);
  const isCollapsed = useCoordinationStore((s) => s.isCollapsed);
  const filterType = useCoordinationStore((s) => s.filterType);
  const filterParentTaskId = useCoordinationStore((s) => s.filterParentTaskId);
  const viewMode = useCoordinationStore((s) => s.viewMode);

  // Get stable action references
  const addMessage = useCoordinationStore((s) => s.addMessage);
  const setConnected = useCoordinationStore((s) => s.setConnected);
  const setFilterType = useCoordinationStore((s) => s.setFilterType);
  const setFilterParentTaskId = useCoordinationStore((s) => s.setFilterParentTaskId);
  const toggleCollapsed = useCoordinationStore((s) => s.toggleCollapsed);
  const setViewMode = useCoordinationStore((s) => s.setViewMode);
  const cleanupOldMessages = useCoordinationStore((s) => s.cleanupOldMessages);
  const dedupeMessages = useCoordinationStore((s) => s.dedupeMessages);
  const setRetentionDays = useCoordinationStore((s) => s.setRetentionDays);
  const clearMessages = useCoordinationStore((s) => s.clearMessages);
  const clearMessagesForTask = useCoordinationStore((s) => s.clearMessagesForTask);
  const setCollapsed = useCoordinationStore((s) => s.setCollapsed);

  // Dedupe existing messages on mount (cleans up persisted duplicates)
  useEffect(() => {
    dedupeMessages();
  }, [dedupeMessages]);

  // Important message types for collaboration
  const importantTypes: ContextMessageType[] = [
    "decision",
    "question",
    "answer",
    "blocker",
    "blocker_detected",
    "blocker_resolved",
    "completion",
    "consultation",
    "revision_requested",
    "warning",
    "user_message",
    "worker_ack",
    "expert_response",
  ];

  // Filter messages by type and optionally by parent task
  const filteredMessages = messages.filter((m) => {
    // In threaded view, only show messages with sessionId for clean threading
    // System messages (story_ready, story_claimed, constraints) don't have sessionId
    if (viewMode === "threaded" && !m.sessionId) {
      return false;
    }
    // Filter by type
    if (filterType === "important") {
      if (!importantTypes.includes(m.messageType)) {
        return false;
      }
    } else if (filterType !== "all" && m.messageType !== filterType) {
      return false;
    }
    // Filter by parent task if a filter is set
    if (filterParentTaskId && m.parentTaskId !== filterParentTaskId) {
      return false;
    }
    // Filter out messages that would be empty after cleaning
    const cleanedContent = cleanMessageContent(m.content);
    if (!cleanedContent) {
      return false;
    }
    return true;
  });

  // Group messages by date for rendering with date separators
  const messagesWithDates: Array<{ type: "date"; date: string } | { type: "message"; message: ContextMessage }> = [];
  let lastDateKey = "";
  for (const msg of filteredMessages) {
    const dateKey = getDateKey(msg.createdAt);
    if (dateKey !== lastDateKey) {
      messagesWithDates.push({ type: "date", date: msg.createdAt });
      lastDateKey = dateKey;
    }
    messagesWithDates.push({ type: "message", message: msg });
  }

  // Build set of answered question IDs
  // An answer message references its question via metadata.questionId
  const answeredQuestionIds = new Set<string>();
  for (const msg of messages) {
    if (msg.messageType === "answer" && msg.metadata?.questionId) {
      answeredQuestionIds.add(msg.metadata.questionId as string);
    }
  }

  // Helper to check if a question has been answered
  const isQuestionAnswered = (msg: ContextMessage): boolean => {
    const questionId = msg.metadata?.questionId as string | undefined;
    return questionId ? answeredQuestionIds.has(questionId) : false;
  };

  // Cleanup old messages on mount and periodically
  useEffect(() => {
    cleanupOldMessages();
    const interval = setInterval(cleanupOldMessages, 60 * 60 * 1000); // Run hourly
    return () => clearInterval(interval);
  }, [cleanupOldMessages]);

  // Fetch org settings to sync retention days
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const token = localStorage.getItem("accessToken");
        if (!token) return;

        const response = await fetch(`${API_BASE}/api/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const settings = await response.json();
          if (settings.taskRetentionDays) {
            setRetentionDays(settings.taskRetentionDays);
          }
        }
      } catch {
        // Ignore errors, use default retention
      }
    };
    fetchSettings();
  }, [setRetentionDays]);

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

  // Get messages for parent task - used to check if we need to fetch
  const getMessagesForParentTask = useCoordinationStore((s) => s.getMessagesForParentTask);

  // Fetch existing messages from database (for viewing completed tasks)
  const fetchExistingMessages = useCallback(async () => {
    if (!parentTaskId) return;

    // Skip if we've already fetched for this task (prevents duplicates from persisted store + API fetch)
    if (fetchedTasksRef.current.has(parentTaskId)) {
      return;
    }

    // Also skip if store already has messages for this task (from persistence)
    const existingMessages = getMessagesForParentTask(parentTaskId);
    if (existingMessages.length > 0) {
      fetchedTasksRef.current.add(parentTaskId); // Mark as "fetched" to prevent future attempts
      return;
    }

    const token = localStorage.getItem("accessToken");
    if (!token) return;

    // Mark as fetched before the async call to prevent race conditions
    fetchedTasksRef.current.add(parentTaskId);

    try {
      const response = await fetch(
        `${API_BASE}/api/coordination/context/${parentTaskId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (response.ok) {
        const data = await response.json();
        // Add each existing message to the store (dedup handled by store)
        // API returns { parentTaskId, count, contexts: [...] }
        const contexts = data.contexts || (Array.isArray(data) ? data : []);
        contexts.forEach((msg: ContextMessage) => {
          addMessage(msg, parentTaskId);
        });
      } else {
        toast.warning("Could not load message history");
      }
    } catch {
      toast.warning("Could not load message history");
      // Remove from set on error so retry is possible
      fetchedTasksRef.current.delete(parentTaskId);
    }
  }, [parentTaskId, addMessage, getMessagesForParentTask, toast]);

  // SSE connection using stable callbacks - now passes parentTaskId to addMessage
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
        // Tag message with parentTaskId for tracking
        addMessage(msg, parentTaskId);
      } catch (err) {
        // Failed to parse SSE context message — skip silently
      }
    });

    eventSource.onerror = () => {
      setConnected(false);
      // EventSource will auto-reconnect
    };
  }, [parentTaskId, addMessage, setConnected]);

  // Auto-filter to current task when parentTaskId changes
  // This prevents showing old messages from other tasks
  useEffect(() => {
    if (parentTaskId) {
      setFilterParentTaskId(parentTaskId);
    }
  }, [parentTaskId, setFilterParentTaskId]);

  // Auto-expand and focus feed for Epic mode tasks (multi-expert collaboration)
  // Sets: expanded, threaded view, filtered to current task
  // Standard single-persona tasks stay collapsed
  useEffect(() => {
    if (isEpicMode && parentTaskId) {
      setCollapsed(false);
      setViewMode("threaded");
      setFilterParentTaskId(parentTaskId);
    }
  }, [isEpicMode, parentTaskId, setCollapsed, setViewMode, setFilterParentTaskId]);

  // Connect/disconnect based on parentTaskId (no longer clears messages)
  // Also fetch existing messages when task changes
  useEffect(() => {
    if (parentTaskId && !isCollapsed) {
      // Fetch existing messages first (for completed tasks)
      fetchExistingMessages();
      // Then connect to SSE stream for live updates
      connectStream();
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [parentTaskId, isCollapsed, connectStream, fetchExistingMessages]);

  const handleReconnect = () => {
    connectStream();
  };

  // Determine if we're showing messages from multiple tasks
  const uniqueParentTasks = new Set(filteredMessages.map((m) => m.parentTaskId).filter(Boolean));
  const showTaskIds = uniqueParentTasks.size > 1 || !filterParentTaskId;

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
    <aside className="w-80 flex-shrink-0 border-l border-border/30 bg-background/50 transition-all duration-300 relative flex flex-col h-full">
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
          <span className="text-sm font-semibold text-foreground">Communications</span>
          {messages.length > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium rounded-full bg-primary/20 text-primary">
              {messages.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Clear Button */}
          {messages.length > 0 && (
            <button
              onClick={() => {
                if (filterParentTaskId) {
                  // Clear only messages for the filtered task
                  clearMessagesForTask(filterParentTaskId);
                } else {
                  // Clear all messages
                  clearMessages();
                }
              }}
              className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
              title={filterParentTaskId ? "Clear messages for this task" : "Clear all messages"}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Connection Status */}
          {parentTaskId && (
            isConnected ? (
              <span title="Connected to live stream">
                <Wifi className="w-3 h-3 text-green-500" />
              </span>
            ) : (
              <button
                onClick={handleReconnect}
                className="flex items-center gap-1 text-yellow-500 hover:text-yellow-400"
                title="Click to reconnect"
              >
                <WifiOff className="w-3 h-3" />
              </button>
            )
          )}
        </div>
      </div>

      {/* Filter Controls */}
      <div className="px-3 py-2 border-b border-border/30 space-y-2">
        {/* Message Type Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3 h-3 text-muted-foreground" />
          <select
            value={filterType}
            onChange={(e) =>
              setFilterType(e.target.value as ContextMessageType | "all" | "important")
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

        {/* Task Filter - show option to filter to current task or all */}
        {parentTaskId && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Show:</span>
            <button
              onClick={() => setFilterParentTaskId(null)}
              className={`px-2 py-0.5 text-xs rounded ${
                !filterParentTaskId
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              All Tasks
            </button>
            <button
              onClick={() => setFilterParentTaskId(parentTaskId)}
              className={`px-2 py-0.5 text-xs rounded ${
                filterParentTaskId === parentTaskId
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {taskLabels[parentTaskId] || "Current"}
            </button>
          </div>
        )}

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">View:</span>
          <button
            onClick={() => setViewMode("threaded")}
            className={`px-2 py-0.5 text-xs rounded ${
              viewMode === "threaded"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            title="Group messages by story"
          >
            Threaded
          </button>
          <button
            onClick={() => setViewMode("flat")}
            className={`px-2 py-0.5 text-xs rounded ${
              viewMode === "flat"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            title="Show all messages chronologically"
          >
            Flat
          </button>
        </div>
      </div>

      {/* Message List with Date Separators */}
      <div
        ref={feedRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto relative"
      >
        {filteredMessages.length === 0 ? (
          <div className="p-8 text-center">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {parentTaskId && !isEpicMode ? "Single-expert mode" : "No messages yet"}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {parentTaskId && !isEpicMode
                ? "This task uses a single expert — coordination messages appear in multi-expert (Epic) mode."
                : parentTaskId
                  ? "Coordination messages from workers will appear here"
                  : "Select a task's \"Feed\" button to stream live messages"}
            </p>
          </div>
        ) : viewMode === "threaded" ? (
          // Threaded view: group messages by sessionId (story)
          groupMessagesBySession(filteredMessages).map((group) => (
            <ThreadGroupView
              key={group.sessionId}
              group={group}
              onAnswerQuestion={onAnswerQuestion}
              showTaskId={showTaskIds}
              taskLabels={taskLabels}
              answeredQuestionIds={answeredQuestionIds}
            />
          ))
        ) : (
          // Flat view: chronological with date separators
          messagesWithDates.map((item) =>
            item.type === "date" ? (
              <DateSeparator key={`date-${item.date}`} date={item.date} />
            ) : item.message.messageType === "question" ? (
              <QuestionMessage
                key={item.message.id}
                message={item.message}
                onAnswer={(answer) => onAnswerQuestion?.(item.message.id, answer)}
                hasAnswer={isQuestionAnswered(item.message)}
              />
            ) : (
              <FeedMessage
                key={item.message.id}
                message={item.message}
                showTaskId={showTaskIds}
                taskLabel={item.message.parentTaskId ? taskLabels[item.message.parentTaskId] : undefined}
              />
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
