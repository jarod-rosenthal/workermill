/**
 * Ralph Log Parser
 *
 * Parses Ralph progress markers from task logs to track multi-story execution.
 * Ralph executes tasks as multiple "stories" (sub-tasks) and emits progress markers.
 *
 * Log marker formats:
 *   ::ralph_progress::<current>/<total>::<description>
 *   ::ralph_stories_completed::<count>
 *   ::ralph_status::<status>
 */

export type RalphStatus = "planning" | "executing" | "completed" | "failed" | "unknown";

export interface RalphProgress {
  currentStory: number;
  totalStories: number;
  currentStoryDescription: string;
  completedStories: number;
  status: RalphStatus;
}

/**
 * Parse a single Ralph progress marker line
 * Format: ::ralph_progress::<current>/<total>::<description>
 */
export function parseRalphProgressMarker(line: string): Partial<RalphProgress> | null {
  if (!line.includes("::ralph_progress::")) {
    return null;
  }

  // Extract the progress part after the marker
  // Format: ::ralph_progress::1/5::Some description
  const match = line.match(/::ralph_progress::(\d+)\/(\d+)::(.+?)$/);
  if (!match) {
    return null;
  }

  const current = parseInt(match[1], 10);
  const total = parseInt(match[2], 10);
  const description = match[3].trim();

  if (isNaN(current) || isNaN(total)) {
    return null;
  }

  return {
    currentStory: current,
    totalStories: total,
    currentStoryDescription: description,
  };
}

/**
 * Parse Ralph completed stories count
 * Format: ::ralph_stories_completed::<count>
 */
export function parseRalphCompletedMarker(line: string): number | null {
  const match = line.match(/::ralph_stories_completed::(\d+)/);
  if (!match) {
    return null;
  }
  const count = parseInt(match[1], 10);
  return isNaN(count) ? null : count;
}

/**
 * Parse Ralph status marker
 * Format: ::ralph_status::<status>
 */
export function parseRalphStatusMarker(line: string): RalphStatus | null {
  const match = line.match(/::ralph_status::(\w+)/);
  if (!match) {
    return null;
  }
  const status = match[1].toLowerCase();
  if (
    status === "planning" ||
    status === "executing" ||
    status === "completed" ||
    status === "failed" ||
    status === "in_progress"
  ) {
    // Map in_progress to executing for consistency
    return status === "in_progress" ? "executing" : (status as RalphStatus);
  }
  return "unknown";
}

/**
 * Check if a log line contains any Ralph marker
 */
export function isRalphMarker(line: string): boolean {
  return (
    line.includes("::ralph_progress::") ||
    line.includes("::ralph_stories_completed::") ||
    line.includes("::ralph_status::")
  );
}

/**
 * Check if logs indicate this is a Ralph task
 * Looks for [ralph] prefix or Ralph markers in log messages
 */
export function detectRalphTask(messages: string[]): boolean {
  return messages.some(
    (msg) =>
      msg.includes("[ralph]") ||
      msg.includes("::ralph_progress::") ||
      msg.includes("::ralph_stories_completed::") ||
      msg.includes("::ralph_status::") ||
      msg.toLowerCase().includes("ralph execution") ||
      msg.toLowerCase().includes("starting ralph")
  );
}

/**
 * Parse all Ralph progress from an array of log messages
 * Returns the most recent progress state by scanning all logs
 */
export function parseRalphProgress(messages: string[]): RalphProgress | null {
  let progress: RalphProgress | null = null;

  // Scan all messages to build up the current state
  for (const message of messages) {
    // Check for progress marker (most important)
    const progressPart = parseRalphProgressMarker(message);
    if (progressPart) {
      if (!progress) {
        progress = {
          currentStory: 0,
          totalStories: 0,
          currentStoryDescription: "",
          completedStories: 0,
          status: "executing",
        };
      }
      progress.currentStory = progressPart.currentStory ?? progress.currentStory;
      progress.totalStories = progressPart.totalStories ?? progress.totalStories;
      progress.currentStoryDescription =
        progressPart.currentStoryDescription ?? progress.currentStoryDescription;
    }

    // Check for completed stories marker
    const completed = parseRalphCompletedMarker(message);
    if (completed !== null) {
      if (!progress) {
        progress = {
          currentStory: 0,
          totalStories: 0,
          currentStoryDescription: "",
          completedStories: 0,
          status: "executing",
        };
      }
      progress.completedStories = completed;
    }

    // Check for status marker
    const status = parseRalphStatusMarker(message);
    if (status) {
      if (!progress) {
        progress = {
          currentStory: 0,
          totalStories: 0,
          currentStoryDescription: "",
          completedStories: 0,
          status: "executing",
        };
      }
      progress.status = status;
    }
  }

  return progress;
}

/**
 * Format Ralph progress for display
 */
export function formatRalphProgressString(progress: RalphProgress): string {
  const percent = progress.totalStories > 0
    ? Math.round((progress.completedStories / progress.totalStories) * 100)
    : 0;
  return `Story ${progress.currentStory}/${progress.totalStories} (${percent}% complete): ${progress.currentStoryDescription}`;
}
