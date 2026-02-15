import { useState } from "react";
import { MessageSquare, Eye, EyeOff } from "lucide-react";

interface TaskDetailFooterProps {
  onTalkClick: () => void;
}

export function TaskDetailFooter({ onTalkClick }: TaskDetailFooterProps) {
  const [following, setFollowing] = useState(true);

  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-card/50">
      <button
        onClick={onTalkClick}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
      >
        <MessageSquare className="w-3.5 h-3.5" />
        Talk to Worker
      </button>

      <button
        onClick={() => setFollowing((f) => !f)}
        className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
          following
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        }`}
      >
        {following ? (
          <>
            <Eye className="w-3.5 h-3.5" />
            Following
          </>
        ) : (
          <>
            <EyeOff className="w-3.5 h-3.5" />
            Paused
          </>
        )}
      </button>
    </div>
  );
}
