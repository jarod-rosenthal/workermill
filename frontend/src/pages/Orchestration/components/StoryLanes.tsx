import { Layers } from "lucide-react";
import type { ChildTask } from "../orchestration-store";
import { StoryLane } from "./StoryLane";

interface StoryLanesProps {
  children: ChildTask[];
  expandedStoryId: string | null;
  onToggleStory: (storyId: string) => void;
  isLoading: boolean;
}

/**
 * Container component for story lanes
 * Displays a list of stories with expand/collapse functionality
 */
export function StoryLanes({
  children,
  expandedStoryId,
  onToggleStory,
  isLoading,
}: StoryLanesProps) {
  if (isLoading && children.length === 0) {
    return (
      <div className="mc-theater">
        <div className="mc-theater-header">
          <span className="mc-theater-title">Stories</span>
        </div>
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="mc-tile p-4">
              <div className="flex items-center gap-4">
                <div className="mc-skeleton w-4 h-4" />
                <div className="mc-skeleton w-24 h-5" />
                <div className="mc-skeleton w-48 h-4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="mc-theater">
        <div className="mc-theater-header">
          <span className="mc-theater-title">Stories</span>
          <span className="mc-theater-count">0</span>
        </div>
        <div className="mc-empty">
          <div className="mc-empty-icon">
            <Layers />
          </div>
          <div className="mc-empty-title">No stories yet</div>
          <div className="mc-empty-desc">
            The Project Manager is analyzing the PRD and will create stories shortly
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mc-theater">
      <div className="mc-theater-header">
        <span className="mc-theater-title">
          Stories
          <span className="mc-theater-count">{children.length}</span>
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {children.map((story) => (
          <StoryLane
            key={story.id}
            story={story}
            isExpanded={expandedStoryId === story.id}
            onToggle={() => onToggleStory(story.id)}
          />
        ))}
      </div>
    </div>
  );
}
