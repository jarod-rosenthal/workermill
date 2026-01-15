#!/bin/bash
# Ralph Progress Parser
# Reads .ralph/progress.json and outputs progress markers
# Called periodically by execute.sh during Ralph execution

# Usage: parse-progress.sh [progress_file_path]
# Output: ::ralph_progress::<current>/<total>::<current_story_description>
#         ::ralph_stories_completed::<count>

set -e

PROGRESS_FILE="${1:-/workspace/repo/.ralph/progress.json}"

# Check if progress file exists
if [ ! -f "$PROGRESS_FILE" ]; then
    exit 0
fi

# Parse progress.json using jq
# Expected structure (based on Ralph config callbacks):
# {
#   "stories": [...],
#   "currentStoryIndex": 0,
#   "completedStories": 2,
#   "totalStories": 5,
#   "currentStory": { "id": "...", "title": "..." },
#   "status": "in_progress" | "completed" | "failed",
#   "prUrl": "https://...",
#   "prNumber": 123
# }

# Get total stories count
TOTAL_STORIES=$(jq -r '.totalStories // (.stories | length) // 0' "$PROGRESS_FILE" 2>/dev/null || echo "0")

# Get completed stories count
COMPLETED_STORIES=$(jq -r '.completedStories // 0' "$PROGRESS_FILE" 2>/dev/null || echo "0")

# Get current story index (0-based, so add 1 for display)
CURRENT_INDEX=$(jq -r '.currentStoryIndex // 0' "$PROGRESS_FILE" 2>/dev/null || echo "0")
CURRENT_DISPLAY=$((CURRENT_INDEX + 1))

# Get current story description
CURRENT_STORY_TITLE=$(jq -r '.currentStory.title // .currentStory.summary // .stories[.currentStoryIndex].title // .stories[.currentStoryIndex].summary // "Processing..."' "$PROGRESS_FILE" 2>/dev/null || echo "Processing...")

# Get overall status
STATUS=$(jq -r '.status // "unknown"' "$PROGRESS_FILE" 2>/dev/null || echo "unknown")

# Output progress markers if we have valid data
if [ "$TOTAL_STORIES" != "0" ] && [ "$TOTAL_STORIES" != "null" ]; then
    # Story progress marker
    echo "::ralph_progress::${CURRENT_DISPLAY}/${TOTAL_STORIES}::${CURRENT_STORY_TITLE}"

    # Completed stories marker
    echo "::ralph_stories_completed::${COMPLETED_STORIES}"
fi

# Output status marker if not unknown
if [ "$STATUS" != "unknown" ] && [ "$STATUS" != "null" ]; then
    echo "::ralph_status::${STATUS}"
fi

exit 0
