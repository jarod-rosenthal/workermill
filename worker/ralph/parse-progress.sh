***REMOVED***!/bin/bash
***REMOVED*** Ralph Progress Parser
***REMOVED*** Reads .ralph/progress.json and outputs progress markers
***REMOVED*** Called periodically by execute.sh during Ralph execution

***REMOVED*** Usage: parse-progress.sh [progress_file_path]
***REMOVED*** Output: ::ralph_progress::<current>/<total>::<current_story_description>
***REMOVED***         ::ralph_stories_completed::<count>

set -e

PROGRESS_FILE="${1:-/workspace/repo/.ralph/progress.json}"

***REMOVED*** Check if progress file exists
if [ ! -f "$PROGRESS_FILE" ]; then
    exit 0
fi

***REMOVED*** Parse progress.json using jq
***REMOVED*** Expected structure (based on Ralph config callbacks):
***REMOVED*** {
***REMOVED***   "stories": [...],
***REMOVED***   "currentStoryIndex": 0,
***REMOVED***   "completedStories": 2,
***REMOVED***   "totalStories": 5,
***REMOVED***   "currentStory": { "id": "...", "title": "..." },
***REMOVED***   "status": "in_progress" | "completed" | "failed",
***REMOVED***   "prUrl": "https://...",
***REMOVED***   "prNumber": 123
***REMOVED*** }

***REMOVED*** Get total stories count
TOTAL_STORIES=$(jq -r '.totalStories // (.stories | length) // 0' "$PROGRESS_FILE" 2>/dev/null || echo "0")

***REMOVED*** Get completed stories count
COMPLETED_STORIES=$(jq -r '.completedStories // 0' "$PROGRESS_FILE" 2>/dev/null || echo "0")

***REMOVED*** Get current story index (0-based, so add 1 for display)
CURRENT_INDEX=$(jq -r '.currentStoryIndex // 0' "$PROGRESS_FILE" 2>/dev/null || echo "0")
CURRENT_DISPLAY=$((CURRENT_INDEX + 1))

***REMOVED*** Get current story description
CURRENT_STORY_TITLE=$(jq -r '.currentStory.title // .currentStory.summary // .stories[.currentStoryIndex].title // .stories[.currentStoryIndex].summary // "Processing..."' "$PROGRESS_FILE" 2>/dev/null || echo "Processing...")

***REMOVED*** Get overall status
STATUS=$(jq -r '.status // "unknown"' "$PROGRESS_FILE" 2>/dev/null || echo "unknown")

***REMOVED*** Output progress markers if we have valid data
if [ "$TOTAL_STORIES" != "0" ] && [ "$TOTAL_STORIES" != "null" ]; then
    ***REMOVED*** Story progress marker
    echo "::ralph_progress::${CURRENT_DISPLAY}/${TOTAL_STORIES}::${CURRENT_STORY_TITLE}"

    ***REMOVED*** Completed stories marker
    echo "::ralph_stories_completed::${COMPLETED_STORIES}"
fi

***REMOVED*** Output status marker if not unknown
if [ "$STATUS" != "unknown" ] && [ "$STATUS" != "null" ]; then
    echo "::ralph_status::${STATUS}"
fi

exit 0
