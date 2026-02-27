import { useState, useEffect, useRef } from "react";
import { Send, Wifi, WifiOff, MessageSquare } from "lucide-react";
import {
  useCoordinationStore,
  type ContextMessage,
  type ContextMessageType,
} from "../../store/coordination-store";
import { API_BASE } from "./types";

// Persona config for embedded communications (short labels)
const COMMS_PERSONA_CONFIGS: Record<
  string,
  { emoji: string; shortLabel: string }
> = {
  frontend_developer: { emoji: "\u{1F3A8}", shortLabel: "Frontend" },
  backend_developer: { emoji: "\u2699\uFE0F", shortLabel: "Backend" },
  architect: { emoji: "\u{1F3D7}\uFE0F", shortLabel: "Architect" },
  devops_engineer: { emoji: "\u{1F527}", shortLabel: "DevOps" },
  security_engineer: { emoji: "\u{1F512}", shortLabel: "Security" },
  qa_engineer: { emoji: "\u{1F9EA}", shortLabel: "QA" },
  data_ml_engineer: { emoji: "\u{1F4CA}", shortLabel: "Data/ML" },
  mobile_developer: { emoji: "\u{1F4F1}", shortLabel: "Mobile" },
  tech_lead: { emoji: "\u{1F3AF}", shortLabel: "Tech Lead" },
  tech_writer: { emoji: "\u{1F4DD}", shortLabel: "Docs" },
  project_manager: { emoji: "\u{1F4CB}", shortLabel: "PM" },
  manager: { emoji: "\u{1F454}", shortLabel: "Manager" },
};

// Message type config for embedded communications
const COMMS_MESSAGE_TYPE_CONFIG: Record<
  ContextMessageType,
  { emoji: string; color: string }
> = {
  file_created: { emoji: "\u{1F4C1}", color: "text-green-500" },
  file_modified: { emoji: "\u{1F4DD}", color: "text-blue-500" },
  decision: { emoji: "\u{1F500}", color: "text-cyan-500" },
  dependency: { emoji: "\u{1F4CB}", color: "text-yellow-500" },
  question: { emoji: "\u2753", color: "text-yellow-500" },
  answer: { emoji: "\u{1F4AC}", color: "text-blue-500" },
  completion: { emoji: "\u2705", color: "text-green-500" },
  blocker: { emoji: "\u{1F6AB}", color: "text-red-500" },
  blocker_detected: { emoji: "\u{1F6A8}", color: "text-red-500" },
  blocker_resolved: { emoji: "\u2705", color: "text-green-500" },
  rate_limited: { emoji: "\u231B", color: "text-amber-500" },
  warning: { emoji: "\u26A0\uFE0F", color: "text-yellow-500" },
  progress: {
    emoji: "\u{1F4CA}",
    color: "text-muted-foreground",
  },
  story_ready: { emoji: "\u{1F4D6}", color: "text-purple-500" },
  story_claimed: { emoji: "\u{1F464}", color: "text-cyan-500" },
  consultation: { emoji: "\u{1F91D}", color: "text-purple-500" },
  constraints: { emoji: "\u{1F4CB}", color: "text-blue-500" },
  revision_requested: {
    emoji: "\u{1F504}",
    color: "text-yellow-500",
  },
  user_message: { emoji: "\u{1F4E8}", color: "text-cyan-500" },
  worker_ack: { emoji: "\u2705", color: "text-green-500" },
  expert_response: { emoji: "\u{1F4AC}", color: "text-indigo-500" },
};

// Embedded Communications Feed - compact version for the side panel
export function EmbeddedCommunicationsFeed({
  taskId,
  parentTaskId,
  isTerminal = false,
  isChildTask = false,
  onAnswerQuestion,
}: {
  taskId: string;
  parentTaskId?: string | null;
  isTerminal?: boolean;
  isChildTask?: boolean;
  onAnswerQuestion?: (messageId: string, answer: string) => void;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fetchedRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  // State for answering questions
  const [answeringMessageId, setAnsweringMessageId] = useState<
    string | null
  >(null);
  const [answerText, setAnswerText] = useState("");
  // Track expanded decision messages (collapsed by default when > 120 chars)
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(
    new Set(),
  );

  // Get store methods
  const messages = useCoordinationStore((s) => s.messages);
  const addMessage = useCoordinationStore((s) => s.addMessage);
  const getMessagesForParentTask = useCoordinationStore(
    (s) => s.getMessagesForParentTask,
  );

  // For child tasks, coordination messages are stored under the parent task ID
  const coordinationTaskId = (isChildTask && parentTaskId) ? parentTaskId : taskId;

  // Filter messages for this specific task
  // Exclude story_ready -- internal coordination data, not team collaboration
  const taskMessages = messages.filter(
    (m) =>
      m.parentTaskId === coordinationTaskId && m.messageType !== "story_ready",
  );

  // Important types to highlight
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

  // Build set of answered question IDs (check if any answer references this question)
  const answeredQuestionIds = new Set<string>();
  for (const msg of taskMessages) {
    if (msg.messageType === "answer" && msg.metadata?.questionId) {
      answeredQuestionIds.add(msg.metadata.questionId as string);
    }
  }

  // Handle submitting an answer
  const handleSubmitAnswer = (messageId: string) => {
    if (answerText.trim() && onAnswerQuestion) {
      onAnswerQuestion(messageId, answerText.trim());
      setAnswerText("");
      setAnsweringMessageId(null);
    }
  };

  // Fetch existing messages
  useEffect(() => {
    if (fetchedRef.current) return;

    const existingMessages = getMessagesForParentTask(coordinationTaskId);
    if (existingMessages.length > 0) {
      fetchedRef.current = true;
      return;
    }

    const fetchMessages = async () => {
      const token = localStorage.getItem("accessToken");
      if (!token) return;

      fetchedRef.current = true;
      try {
        const response = await fetch(
          `${API_BASE}/api/coordination/context/${coordinationTaskId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (response.ok) {
          const data = await response.json();
          const contexts =
            data.contexts || (Array.isArray(data) ? data : []);
          contexts.forEach((msg: ContextMessage) => {
            addMessage(msg, coordinationTaskId);
          });
        }
      } catch (err) {
        console.error(
          "Failed to fetch coordination messages:",
          err,
        );
        fetchedRef.current = false;
      }
    };
    fetchMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getMessagesForParentTask is stable but not memoized
  }, [coordinationTaskId]);

  // Connect to SSE stream
  // Skip for terminal tasks (no new messages expected)
  // For child tasks, subscribe to the parent's coordination stream
  useEffect(() => {
    if (isTerminal) return;

    const token = localStorage.getItem("accessToken");
    if (!token) return;

    const url = `${API_BASE}/api/coordination/context/${coordinationTaskId}/stream?token=${encodeURIComponent(token)}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => setIsConnected(true);
    eventSource.addEventListener("context", (event) => {
      try {
        const msg = JSON.parse(event.data) as ContextMessage;
        addMessage(msg, coordinationTaskId);
      } catch (err) {
        console.error("Failed to parse context message:", err);
      }
    });
    eventSource.onerror = () => setIsConnected(false);

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [coordinationTaskId, addMessage, isTerminal]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [taskMessages.length]);

  // Clean message content (remove JSON artifacts)
  const cleanContent = (content: string): string => {
    if (!content) return content;
    let cleaned = content;
    cleaned = cleaned.replace(
      /\{[^{}]*"(?:type|input_tokens|output_tokens)"[^{}]*\}/g,
      "",
    );
    cleaned = cleaned.replace(/\s*\{[^{}]*\}\s*$/g, "");
    cleaned = cleaned.trim();
    return cleaned || content;
  };

  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  return (
    <div className="h-96 flex flex-col">
      {/* Header with connection status */}
      <div className="px-3 py-2 border-b border-border/30 flex items-center justify-between bg-muted/30">
        <span className="text-xs text-muted-foreground">
          {taskMessages.length} message
          {taskMessages.length !== 1 ? "s" : ""}
        </span>
        {isConnected ? (
          <span className="flex items-center gap-1 text-xs text-green-500">
            <Wifi className="w-3 h-3" /> Live
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-yellow-500">
            <WifiOff className="w-3 h-3" /> Connecting...
          </span>
        )}
      </div>

      {/* Messages */}
      <div ref={feedRef} className="flex-1 overflow-y-auto">
        {taskMessages.length === 0 ? (
          <div className="p-4 text-center">
            <MessageSquare className="w-6 h-6 mx-auto mb-2 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              No communications yet
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Expert collaboration messages will appear here
            </p>
          </div>
        ) : (
          taskMessages.map((msg) => {
            const typeConfig =
              COMMS_MESSAGE_TYPE_CONFIG[msg.messageType];
            const personaConfig =
              COMMS_PERSONA_CONFIGS[msg.persona];
            const isImportant = importantTypes.includes(
              msg.messageType,
            );
            const cleanedContent = cleanContent(msg.content);
            const isQuestion =
              msg.messageType === "question" ||
              msg.messageType === "consultation";
            // Check if this question has been answered - answers reference the question's msg.id in metadata.questionId
            const hasAnswer =
              isQuestion && answeredQuestionIds.has(msg.id);
            const suggestedAnswers =
              (msg.metadata?.suggestedAnswers as string[]) || [];
            // Human-readable question ID for display (e.g., "Q-BACKEND-001")
            const displayQuestionId = msg.metadata
              ?.questionId as string | undefined;

            // Render question messages with answer UI
            if (isQuestion) {
              return (
                <div
                  key={msg.id}
                  className="px-3 py-2 border-b border-border/30 bg-yellow-500/5"
                >
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {formatTime(msg.createdAt)}
                    </span>
                    <span className="text-xs text-yellow-500 font-medium">
                      {"\u26A0\uFE0F"}{" "}
                      {personaConfig?.shortLabel || msg.persona}
                    </span>
                    {hasAnswer && (
                      <span className="text-xs text-green-500 font-medium">
                        {"\u2713"} Answered
                      </span>
                    )}
                  </div>
                  {/* Question Card */}
                  <div className="bg-muted/50 border border-border/50 rounded-md p-2">
                    <div className="flex items-start gap-2">
                      <span
                        className={
                          hasAnswer
                            ? "text-green-500"
                            : "text-yellow-500"
                        }
                      >
                        {hasAnswer ? "\u2705" : "\u2753"}
                      </span>
                      <div className="flex-1">
                        <span className="text-xs text-foreground font-medium">
                          {displayQuestionId
                            ? `${displayQuestionId}:`
                            : "QUESTION:"}
                        </span>
                        <p className="text-xs text-muted-foreground mt-1">
                          {cleanedContent}
                        </p>
                      </div>
                    </div>

                    {/* Answer Buttons - only show if not answered and handler provided */}
                    {!hasAnswer &&
                      onAnswerQuestion &&
                      answeringMessageId !== msg.id && (
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {suggestedAnswers.map((answer, idx) => (
                            <button
                              key={idx}
                              onClick={() =>
                                onAnswerQuestion(msg.id, answer)
                              }
                              className="px-2 py-0.5 text-[10px] font-medium bg-muted border border-border rounded hover:bg-muted/80 hover:border-primary/50 transition-colors"
                            >
                              {answer}
                            </button>
                          ))}
                          <button
                            onClick={() =>
                              setAnsweringMessageId(msg.id)
                            }
                            className="px-2 py-0.5 text-[10px] font-medium text-primary bg-transparent border border-primary rounded hover:bg-primary hover:text-primary-foreground transition-colors"
                          >
                            Answer...
                          </button>
                        </div>
                      )}

                    {/* Custom Answer Input */}
                    {!hasAnswer &&
                      answeringMessageId === msg.id && (
                        <div className="mt-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={answerText}
                              onChange={(e) =>
                                setAnswerText(e.target.value)
                              }
                              onKeyDown={(e) =>
                                e.key === "Enter" &&
                                handleSubmitAnswer(msg.id)
                              }
                              placeholder="Type your answer..."
                              className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:border-primary"
                              autoFocus
                            />
                            <button
                              onClick={() =>
                                handleSubmitAnswer(msg.id)
                              }
                              disabled={!answerText.trim()}
                              className="p-1 text-primary hover:bg-muted rounded disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Send className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => {
                                setAnsweringMessageId(null);
                                setAnswerText("");
                              }}
                              className="px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
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

            // Render normal messages
            const isLongDecision =
              msg.messageType === "decision" &&
              cleanedContent.length > 120;
            const isExpanded = expandedMessages.has(msg.id);
            const displayContent =
              isLongDecision && !isExpanded
                ? cleanedContent.substring(
                    0,
                    cleanedContent.indexOf(":") > 0 &&
                      cleanedContent.indexOf(":") < 20
                      ? cleanedContent.indexOf(
                            ":",
                            cleanedContent.indexOf(":") + 1,
                          ) > 0
                        ? cleanedContent.indexOf(
                            ":",
                            cleanedContent.indexOf(":") + 1,
                          )
                        : 120
                      : 120,
                  )
                : cleanedContent;

            return (
              <div
                key={msg.id}
                className={`px-3 py-2 border-b border-border/30 hover:bg-muted/30 ${
                  isImportant ? "bg-primary/5" : ""
                }`}
              >
                {/* Header */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {formatTime(msg.createdAt)}
                  </span>
                  <span
                    className={`text-xs ${typeConfig?.color || "text-muted-foreground"}`}
                  >
                    {personaConfig?.emoji || "\u{1F916}"}{" "}
                    {personaConfig?.shortLabel || msg.persona}
                  </span>
                </div>
                {/* Content */}
                <div className="flex items-start gap-2">
                  <span
                    className={
                      typeConfig?.color || "text-muted-foreground"
                    }
                  >
                    {typeConfig?.emoji || "\u{1F4AC}"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-xs text-muted-foreground ${!isLongDecision ? "line-clamp-3" : ""}`}
                    >
                      {displayContent}
                      {isLongDecision && !isExpanded ? "..." : ""}
                    </p>
                    {isLongDecision && (
                      <button
                        onClick={() =>
                          setExpandedMessages((prev) => {
                            const next = new Set(prev);
                            if (next.has(msg.id))
                              next.delete(msg.id);
                            else next.add(msg.id);
                            return next;
                          })
                        }
                        className="text-[10px] text-primary hover:underline mt-0.5"
                      >
                        {isExpanded ? "collapse" : "expand"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
