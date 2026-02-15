import { useState, useCallback } from "react";
import { TaskDetailView } from "./TaskDetailView";
import {
  mockStreamingLogs,
  mockParsedErrors,
  mockCoordinationMessages,
  mockBlocker,
  mockTask,
} from "./mock-data";

/**
 * Standalone demo page for TaskDetailView.
 * Mount at /demo/task-detail for visual validation.
 * No store, SSE, or API dependencies — pure mock data.
 */
export default function TaskDetailDemo() {
  const [selectedStoryIndex, setSelectedStoryIndex] = useState<number | null>(null);

  const handleTalkClick = useCallback(() => {
    console.log("[TaskDetailDemo] Talk to worker clicked");
  }, []);

  const handleBlockerAction = useCallback((action: "retry" | "skip" | "abort") => {
    console.log(`[TaskDetailDemo] Blocker action: ${action}`);
  }, []);

  const handleStorySelect = useCallback((index: number | null) => {
    setSelectedStoryIndex(index);
  }, []);

  return (
    <div className="h-screen w-screen bg-background text-foreground" data-theme="dark">
      <TaskDetailView
        task={mockTask}
        logs={mockStreamingLogs}
        errors={mockParsedErrors}
        coordinationMessages={mockCoordinationMessages}
        activeBlocker={mockBlocker}
        isStreaming={true}
        onTalkClick={handleTalkClick}
        onBlockerAction={handleBlockerAction}
        onStorySelect={handleStorySelect}
        selectedStoryIndex={selectedStoryIndex}
      />
    </div>
  );
}
