#!/bin/bash
# Test script for checkpoint functionality
# Run locally to verify checkpoint init, update, get, and status functions

set -e

echo "=== WorkerMill Checkpoint Testing ==="
echo ""

# Source checkpoint library
source "$(dirname "${BASH_SOURCE[0]}")/checkpoint.sh"

# Set up test environment
export TASK_ID="test-task-001"
export CHECKPOINT_ENABLED="true"
TEST_DIR=$(mktemp -d)
export CHECKPOINT_DIR="${TEST_DIR}"
CHECKPOINT_FILE="${TEST_DIR}/checkpoint.json"

echo "Test Directory: ${TEST_DIR}"
echo "Checkpoint File: ${CHECKPOINT_FILE}"
echo ""

# Test 1: Initialize checkpoint
echo "TEST 1: Initialize checkpoint"
checkpoint_init
if [ -f "${CHECKPOINT_FILE}" ]; then
    echo "✓ Checkpoint file created"
else
    echo "✗ Checkpoint file not created"
    exit 1
fi

# Verify structure
if jq empty "${CHECKPOINT_FILE}" 2>/dev/null; then
    echo "✓ Checkpoint JSON is valid"
else
    echo "✗ Checkpoint JSON is invalid"
    exit 1
fi

echo ""

# Test 2: Update stage
echo "TEST 2: Update stage"
checkpoint_update "stage" "cloning" || true
STAGE=$(jq -r '.stage' "${CHECKPOINT_FILE}")
if [ "${STAGE}" = "cloning" ]; then
    echo "✓ Stage updated to: ${STAGE}"
else
    echo "✗ Stage not updated correctly (got: ${STAGE})"
    exit 1
fi

echo ""

# Test 3: Update branch
echo "TEST 3: Update branch"
checkpoint_update "branch" "ai/OCS-123" || true
BRANCH=$(jq -r '.branch' "${CHECKPOINT_FILE}")
if [ "${BRANCH}" = "ai/OCS-123" ]; then
    echo "✓ Branch updated to: ${BRANCH}"
else
    echo "✗ Branch not updated correctly (got: ${BRANCH})"
    exit 1
fi

echo ""

# Test 4: Set repoCloned
echo "TEST 4: Set repoCloned"
checkpoint_update "repoCloned" "true" || true
CLONED=$(jq -r '.repoCloned' "${CHECKPOINT_FILE}")
if [ "${CLONED}" = "true" ]; then
    echo "✓ repoCloned set to: ${CLONED}"
else
    echo "✗ repoCloned not updated correctly (got: ${CLONED})"
    exit 1
fi

echo ""

# Test 5: Add files analyzed
echo "TEST 5: Add analyzed files"
checkpoint_update "filesAnalyzed" "src/api/handlers.ts" || true
checkpoint_update "filesAnalyzed" "src/models/User.ts" || true
FILE_COUNT=$(jq '.filesAnalyzed | length' "${CHECKPOINT_FILE}")
if [ "${FILE_COUNT}" = "2" ]; then
    echo "✓ Added 2 analyzed files (count: ${FILE_COUNT})"
else
    echo "✗ filesAnalyzed count incorrect (got: ${FILE_COUNT})"
    exit 1
fi

echo ""

# Test 6: Add files modified
echo "TEST 6: Add modified files"
checkpoint_update "filesModified" "src/api/handlers.ts" || true
checkpoint_update "filesModified" "src/models/User.ts" || true
checkpoint_update "filesModified" "tests/api.test.ts" || true
FILE_COUNT=$(jq '.filesModified | length' "${CHECKPOINT_FILE}")
if [ "${FILE_COUNT}" = "3" ]; then
    echo "✓ Added 3 modified files (count: ${FILE_COUNT})"
else
    echo "✗ filesModified count incorrect (got: ${FILE_COUNT})"
    exit 1
fi

echo ""

# Test 7: Add commits
echo "TEST 7: Add commits"
checkpoint_update "commit" "abc123def456" || true
checkpoint_update "commit" "def456ghi789" || true
COMMIT_COUNT=$(jq '.commits | length' "${CHECKPOINT_FILE}")
if [ "${COMMIT_COUNT}" = "2" ]; then
    echo "✓ Added 2 commits (count: ${COMMIT_COUNT})"
else
    echo "✗ commits count incorrect (got: ${COMMIT_COUNT})"
    exit 1
fi

echo ""

# Test 8: Update test status
echo "TEST 8: Update test status"
checkpoint_update "testsRun" "true" || true
checkpoint_update "testsPassed" "true" || true
TESTS_RUN=$(jq -r '.testsRun' "${CHECKPOINT_FILE}")
TESTS_PASSED=$(jq -r '.testsPassed' "${CHECKPOINT_FILE}")
if [ "${TESTS_RUN}" = "true" ] && [ "${TESTS_PASSED}" = "true" ]; then
    echo "✓ Test status updated: run=${TESTS_RUN}, passed=${TESTS_PASSED}"
else
    echo "✗ Test status incorrect: run=${TESTS_RUN}, passed=${TESTS_PASSED}"
    exit 1
fi

echo ""

# Test 9: Update lastAction
echo "TEST 9: Update lastAction"
checkpoint_update "lastAction" "Tests passed, ready to commit" || true
LAST_ACTION=$(jq -r '.lastAction' "${CHECKPOINT_FILE}")
if [ "${LAST_ACTION}" = "Tests passed, ready to commit" ]; then
    echo "✓ lastAction updated"
else
    echo "✗ lastAction not correct (got: ${LAST_ACTION})"
    exit 1
fi

echo ""

# Test 10: checkpoint_get
echo "TEST 10: checkpoint_get function"
RETRIEVED_STAGE=$(checkpoint_get "stage")
if [ "${RETRIEVED_STAGE}" = "cloning" ]; then
    echo "✓ checkpoint_get retrieved correct stage: ${RETRIEVED_STAGE}"
else
    echo "✗ checkpoint_get failed (got: ${RETRIEVED_STAGE})"
    exit 1
fi

echo ""

# Test 11: checkpoint_status
echo "TEST 11: checkpoint_status output"
checkpoint_status

echo ""

# Test 12: Final checkpoint state
echo "TEST 12: Final checkpoint state"
echo "Checkpoint content:"
cat "${CHECKPOINT_FILE}" | jq '.'

echo ""
echo "=== All Tests Passed! ==="

# Cleanup
rm -rf "${TEST_DIR}"
