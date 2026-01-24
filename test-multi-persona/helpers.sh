***REMOVED***!/bin/bash
***REMOVED*** helpers.sh - File-based mock of WorkerContext API
***REMOVED*** These functions mimic the real API but use a local JSON file

CONTEXT_FILE="${TEST_DIR}/context-store.json"

***REMOVED*** Initialize context store if it doesn't exist
init_context_store() {
    if [ ! -f "$CONTEXT_FILE" ]; then
        echo '{"contexts": []}' > "$CONTEXT_FILE"
    fi
}

***REMOVED*** Fetch all context messages (mimics GET /api/coordination/context/:parentTaskId)
fetch_context() {
    init_context_store

    ***REMOVED*** Format context for prompt injection
    local contexts=$(jq -r '.contexts[] | "[\(.persona)] \(.messageType): \(.content)"' "$CONTEXT_FILE" 2>/dev/null)

    if [ -z "$contexts" ]; then
        echo "_No previous context - you are the first subtask._"
    else
        echo "$contexts"
    fi
}

***REMOVED*** Post a context message (mimics POST /api/coordination/context)
post_context() {
    local type="$1"
    local content="$2"
    local persona="${CURRENT_PERSONA:-unknown}"
    local subtask_index="${CURRENT_SUBTASK_INDEX:-0}"

    init_context_store

    ***REMOVED*** Create new context entry
    local timestamp=$(date -Iseconds)
    local new_entry=$(jq -n \
        --arg persona "$persona" \
        --arg type "$type" \
        --arg content "$content" \
        --arg ts "$timestamp" \
        --arg idx "$subtask_index" \
        '{
            persona: $persona,
            messageType: $type,
            content: $content,
            timestamp: $ts,
            subtaskIndex: ($idx | tonumber)
        }')

    ***REMOVED*** Append to context store
    local updated=$(jq --argjson entry "$new_entry" '.contexts += [$entry]' "$CONTEXT_FILE")
    echo "$updated" > "$CONTEXT_FILE"

    echo "[CONTEXT] Posted: [$persona] $type: $content"
}

***REMOVED*** Display current context store (for debugging)
show_context() {
    echo "=== Current Context Store ==="
    jq '.' "$CONTEXT_FILE" 2>/dev/null || echo "No context yet"
    echo "============================="
}

***REMOVED*** Export functions for use in subshells
export -f init_context_store
export -f fetch_context
export -f post_context
export -f show_context
export CONTEXT_FILE
