import { useState, useMemo } from "react";
import type { ContextMessage } from "../../store/coordination-store";

interface StoryTreeProps {
  coordinationMessages: ContextMessage[];
  selectedStoryIndex: number | null;
  onStorySelect: (index: number | null) => void;
}

interface StoryInfo {
  index: number;
  title: string;
  status: "complete" | "running" | "pending" | "revision";
}

export function StoryTree({ coordinationMessages, selectedStoryIndex, onStorySelect }: StoryTreeProps) {
  const [activeTab, setActiveTab] = useState<"stories" | "comms">("stories");

  const stories = useMemo(() => {
    const storyMap = new Map<number, StoryInfo>();

    for (const msg of coordinationMessages) {
      const storyIndex = (msg.metadata?.storyIndex as number) ?? -1;
      if (storyIndex < 0) continue;

      if (msg.messageType === "story_claimed") {
        // Extract title: "Story N: Title" → "Title"
        const title = msg.content.replace(/^Story\s+\d+:\s*/, "");
        storyMap.set(storyIndex, {
          index: storyIndex,
          title,
          status: "running",
        });
      }

      if (msg.messageType === "completion") {
        const existing = storyMap.get(storyIndex);
        if (existing) existing.status = "complete";
      }

      if (msg.messageType === "revision_requested") {
        const existing = storyMap.get(storyIndex);
        if (existing) existing.status = "revision";
      }
    }

    return Array.from(storyMap.values()).sort((a, b) => a.index - b.index);
  }, [coordinationMessages]);

  const statusDot = (status: StoryInfo["status"]) => {
    const colors = {
      complete: "bg-green-500",
      running: "bg-blue-500 animate-pulse",
      pending: "bg-gray-500",
      revision: "bg-amber-500",
    };
    return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]}`} />;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0">
        <button
          onClick={() => setActiveTab("stories")}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === "stories"
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Stories
        </button>
        <button
          onClick={() => setActiveTab("comms")}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === "comms"
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Comms
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "stories" ? (
          <div className="py-1">
            {/* "All" option */}
            <button
              onClick={() => onStorySelect(null)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                selectedStoryIndex === null
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
              <span className="truncate">All stories</span>
            </button>
            {stories.map((story) => (
              <button
                key={story.index}
                onClick={() => onStorySelect(story.index)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                  selectedStoryIndex === story.index
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                {statusDot(story.status)}
                <span className="truncate">
                  <span className="text-muted-foreground mr-1">#{story.index}</span>
                  {story.title}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-3 text-xs text-muted-foreground">
            CoordinationFeed will be embedded here
          </div>
        )}
      </div>
    </div>
  );
}
