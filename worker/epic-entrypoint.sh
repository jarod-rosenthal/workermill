#!/bin/bash
set -e

# Epic Executor Entry Point
# This script is called when EPIC_MODE=true
# It runs the multi-agent collaboration using Agent SDK (Claude CLI subprocess)

echo "============================================================"
echo "EPIC EXECUTOR - Multi-Agent Collaboration with Agent SDK"
echo "============================================================"
echo ""
echo "Parent Task ID: ${PARENT_TASK_ID:-not set}"
echo "Target Repo: ${TARGET_REPO:-${GITHUB_REPO:-not set}}"
echo "API Base URL: ${API_BASE_URL:-not set}"
echo ""

# Validate required environment variables
# Note: For non-GitHub SCM providers (BitBucket, GitLab), SCM_TOKEN is used instead of GITHUB_TOKEN
required_vars=("PARENT_TASK_ID" "API_BASE_URL" "ORG_API_KEY")

missing_vars=()
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

# Anthropic auth check: ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or mounted credentials
if [ -z "${ANTHROPIC_API_KEY}" ] && [ -z "${CLAUDE_CODE_OAUTH_TOKEN}" ]; then
    # In local mode, Claude CLI uses mounted ~/.claude credentials (OAuth refresh token)
    if [ "${EXECUTION_MODE}" = "local" ] && [ -f "/home/worker/.claude/.credentials.json" ]; then
        echo "[Epic] Using mounted Claude credentials for local mode auth"
    else
        missing_vars+=("ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN")
    fi
fi

# SCM token check: GITHUB_TOKEN or SCM_TOKEN must be set
if [ -z "${GITHUB_TOKEN}" ] && [ -z "${SCM_TOKEN}" ]; then
    missing_vars+=("GITHUB_TOKEN or SCM_TOKEN")
fi

# For backwards compatibility, set GITHUB_TOKEN from SCM_TOKEN if not set
if [ -z "${GITHUB_TOKEN}" ] && [ -n "${SCM_TOKEN}" ]; then
    export GITHUB_TOKEN="${SCM_TOKEN}"
fi

# TARGET_REPO can come from either TARGET_REPO or GITHUB_REPO
if [ -z "${TARGET_REPO}" ]; then
    if [ -n "${GITHUB_REPO}" ]; then
        export TARGET_REPO="${GITHUB_REPO}"
    else
        missing_vars+=("TARGET_REPO or GITHUB_REPO")
    fi
fi

if [ ${#missing_vars[@]} -ne 0 ]; then
    echo "[Epic] ERROR: Missing required environment variables:"
    for var in "${missing_vars[@]}"; do
        echo "  - $var"
    done
    exit 1
fi

echo "[Epic] All required environment variables set"

# =============================================================================
# Git Configuration and Repository Clone
# =============================================================================
echo "[Epic] Configuring git..."

# Resolve author email from GitHub API (noreply email for Vercel compatibility)
if [ -z "${AUTHOR_EMAIL}" ] && [ "${SCM_PROVIDER:-github}" = "github" ] && [ -n "${GITHUB_TOKEN}" ]; then
  _gh_user=$(curl -sf -H "Authorization: Bearer ${GITHUB_TOKEN}" https://api.github.com/user 2>/dev/null || true)
  if [ -n "$_gh_user" ]; then
    _gh_id=$(echo "$_gh_user" | grep -o '"id": *[0-9]*' | head -1 | grep -o '[0-9]*')
    _gh_login=$(echo "$_gh_user" | grep -o '"login": *"[^"]*"' | head -1 | sed 's/.*"login": *"//;s/"//')
    if [ -n "$_gh_id" ] && [ -n "$_gh_login" ]; then
      export AUTHOR_EMAIL="${_gh_id}+${_gh_login}@users.noreply.github.com"
      echo "[Epic] Resolved git author email: ${AUTHOR_EMAIL}"
    fi
  fi
fi
export AUTHOR_EMAIL="${AUTHOR_EMAIL:-epic@workermill.com}"

# Configure git identity
git config --global user.name "WorkerMill Epic Agent"
git config --global user.email "${AUTHOR_EMAIL}"

# Configure git credentials storage
git config --global credential.helper store

# Prevent line ending issues
git config --global core.autocrlf false
git config --global core.safecrlf false
git config --global core.eol lf

# Get SCM provider (default to github)
SCM_PROVIDER="${SCM_PROVIDER:-github}"
SCM_BASE_URL="${SCM_BASE_URL:-}"

# Build clone URL based on SCM provider
case "${SCM_PROVIDER}" in
    github)
        SCM_BASE_URL="${SCM_BASE_URL:-github.com}"
        REPO_URL="https://x-access-token:${SCM_TOKEN:-${GITHUB_TOKEN}}@${SCM_BASE_URL}/${TARGET_REPO}.git"

        # Configure GitHub CLI authentication
        echo "${SCM_TOKEN:-${GITHUB_TOKEN}}" | gh auth login --with-token 2>/dev/null || true

        # Store credentials for git
        echo "https://x-access-token:${SCM_TOKEN:-${GITHUB_TOKEN}}@${SCM_BASE_URL}" > ~/.git-credentials
        ;;

    gitlab)
        SCM_BASE_URL="${SCM_BASE_URL:-gitlab.com}"
        REPO_URL="https://oauth2:${SCM_TOKEN}@${SCM_BASE_URL}/${TARGET_REPO}.git"

        echo "https://oauth2:${SCM_TOKEN}@${SCM_BASE_URL}" > ~/.git-credentials
        ;;

    bitbucket)
        SCM_BASE_URL="${SCM_BASE_URL:-bitbucket.org}"

        # BitBucket uses Repository Access Tokens with x-token-auth as username
        # URL-encode special characters in token
        ENCODED_BB_TOKEN=$(printf '%s' "${SCM_TOKEN:-${BITBUCKET_TOKEN}}" | sed 's/=/%3D/g; s/+/%2B/g; s/\//%2F/g')
        REPO_URL="https://x-token-auth:${ENCODED_BB_TOKEN}@${SCM_BASE_URL}/${TARGET_REPO}.git"
        echo "https://x-token-auth:${ENCODED_BB_TOKEN}@${SCM_BASE_URL}" > ~/.git-credentials
        ;;

    *)
        echo "[Epic] ERROR: Unknown SCM provider: ${SCM_PROVIDER}"
        exit 1
        ;;
esac

# Mask token in URL for logging
MASKED_URL=$(echo "${REPO_URL}" | sed 's/:x-access-token:[^@]*@/:x-access-token:***@/; s/:oauth2:[^@]*@/:oauth2:***@/; s/:x-token-auth:[^@]*@/:x-token-auth:***@/')
echo "[Epic] SCM Provider: ${SCM_PROVIDER}"
echo "[Epic] Clone URL: ${MASKED_URL}"

# Clone the repository
WORKSPACE_DIR="/workspace"
REPO_DIR="${WORKSPACE_DIR}/repo"

mkdir -p "${WORKSPACE_DIR}"
cd "${WORKSPACE_DIR}"

echo "[Epic] Cloning repository ${TARGET_REPO}..."
if ! git clone "${REPO_URL}" repo 2>&1; then
    echo "[Epic] ERROR: Failed to clone repository"
    echo "[Epic] Check that your SCM token has read access to ${TARGET_REPO}"
    exit 1
fi

echo "[Epic] Repository cloned successfully to ${REPO_DIR}"
cd "${REPO_DIR}"

# Detect main branch
if git rev-parse --verify origin/main >/dev/null 2>&1; then
    MAIN_BRANCH="main"
elif git rev-parse --verify origin/master >/dev/null 2>&1; then
    MAIN_BRANCH="master"
else
    MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
fi
echo "[Epic] Main branch: ${MAIN_BRANCH}"

# Export repo path for the coordinator
export REPO_PATH="${REPO_DIR}"
export MAIN_BRANCH="${MAIN_BRANCH}"

# Pass 2: detect and install tools based on repo contents
/app/install-tools.sh "${REPO_DIR}"

# =============================================================================
# Heartbeat Loop - sends heartbeats every 30 seconds to prevent timeout
# =============================================================================
HEARTBEAT_PID=""

send_heartbeat() {
    local payload
    payload=$(cat <<EOF
{
  "taskId": "${PARENT_TASK_ID}",
  "workerId": "${ECS_TASK_ID:-epic-worker}",
  "status": "working",
  "persona": "epic_coordinator"
}
EOF
)
    curl -s --connect-timeout 5 --max-time 10 \
        -X POST "${API_BASE_URL}/api/coordination/heartbeat" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "$payload" >/dev/null 2>&1 || true
}

start_heartbeat_loop() {
    (
        while true; do
            sleep 30
            send_heartbeat
        done
    ) &
    HEARTBEAT_PID=$!
    echo "[Epic] Started heartbeat loop (PID: ${HEARTBEAT_PID})"
}

stop_heartbeat_loop() {
    if [ -n "${HEARTBEAT_PID}" ]; then
        kill "${HEARTBEAT_PID}" 2>/dev/null || true
        echo "[Epic] Stopped heartbeat loop"
        HEARTBEAT_PID=""
    fi
}

# Cleanup on exit
cleanup() {
    stop_heartbeat_loop
}
trap cleanup EXIT

# Start heartbeat loop
start_heartbeat_loop

# =============================================================================
# Pre-install Dependencies (local mode only)
# In local/remote-agent mode, containers have tighter memory limits.
# Pre-installing prevents agents from running npm install at runtime, which
# causes OOM when combined with the review phase. npm process memory is freed
# after install completes. Only uses lockfile-based installs (npm ci, etc.)
# to avoid dirtying the git working tree.
# =============================================================================
if [ "${EXECUTION_MODE}" = "local" ]; then
    install_node_deps() {
        local dir="$1"
        local label="${dir#${REPO_DIR}/}"
        [ "$dir" = "${REPO_DIR}" ] && label="root"

        cd "$dir"
        if [ -f "pnpm-lock.yaml" ]; then
            echo "[Epic]   ${label}: pnpm install --frozen-lockfile"
            corepack enable 2>/dev/null || true
            pnpm install --frozen-lockfile 2>&1 | tail -3 || true
        elif [ -f "yarn.lock" ]; then
            echo "[Epic]   ${label}: yarn install --frozen-lockfile"
            corepack enable 2>/dev/null || true
            yarn install --frozen-lockfile 2>&1 | tail -3 || true
        elif [ -f "package-lock.json" ]; then
            echo "[Epic]   ${label}: npm ci"
            npm ci 2>&1 | tail -3 || true
        fi
        cd "${REPO_DIR}"
    }

    echo "[Epic] Pre-installing dependencies (local mode)..."

    # Install at repo root
    if [ -f "${REPO_DIR}/package.json" ]; then
        install_node_deps "${REPO_DIR}"
    fi

    # Install in subdirectories with their own lockfiles (monorepo subprojects)
    find "${REPO_DIR}" -maxdepth 2 \( -name "package-lock.json" -o -name "yarn.lock" -o -name "pnpm-lock.yaml" \) -not -path "*/node_modules/*" 2>/dev/null | while read lockfile; do
        subdir=$(dirname "$lockfile")
        if [ "$subdir" != "${REPO_DIR}" ]; then
            install_node_deps "$subdir"
        fi
    done

    echo "[Epic] Dependency pre-install complete"
fi

# =============================================================================
# Start Epic Executor
# =============================================================================
echo "[Epic] Starting Epic executor..."
echo ""

# Run the compiled Epic executor
cd /app/epic
node dist/index.js
EXIT_CODE=$?

# Cleanup
stop_heartbeat_loop
exit $EXIT_CODE
