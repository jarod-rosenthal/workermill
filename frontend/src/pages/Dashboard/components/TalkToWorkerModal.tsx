import {
  RefreshCw,
  Clock,
  X,
  Zap,
  MessageSquare,
} from "lucide-react";

interface TalkToWorkerModalProps {
  talkTargetTaskTitle: string;
  talkMessage: string;
  setTalkMessage: (msg: string) => void;
  talkLoading: boolean;
  handleTalkToWorker: (immediate: boolean) => void;
  onClose: () => void;
}

export function TalkToWorkerModal({
  talkTargetTaskTitle,
  talkMessage,
  setTalkMessage,
  talkLoading,
  handleTalkToWorker,
  onClose,
}: TalkToWorkerModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 rounded-lg">
              <MessageSquare className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Talk to Worker</h2>
              <p className="text-sm text-muted-foreground">
                Send a message to <span className="font-medium text-cyan-400">{talkTargetTaskTitle}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          <label className="block text-sm font-medium text-muted-foreground mb-2">
            Your message will be delivered to Claude at the next checkpoint.
          </label>
          <textarea
            value={talkMessage}
            onChange={(e) => setTalkMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && talkMessage.trim()) {
                e.preventDefault();
                handleTalkToWorker(true);
              }
            }}
            placeholder="Type your message to the worker..."
            className="w-full h-32 px-4 py-3 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 resize-none"
            autoFocus
            disabled={talkLoading}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Press Ctrl+Enter for immediate delivery, or choose a delivery method below.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border bg-muted/30 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleTalkToWorker(false)}
              disabled={!talkMessage.trim() || talkLoading}
              className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Queue message for next story (no interruption)"
            >
              {talkLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4" />
                  Queue
                </>
              )}
            </button>
            <button
              onClick={() => handleTalkToWorker(true)}
              disabled={!talkMessage.trim() || talkLoading}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Pause worker and deliver message immediately at next checkpoint"
            >
              {talkLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Send Now
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
