#!/bin/bash
# WorkerMill Runtime Tool Installer
# Detects required tools from env vars (Pass 1) and repo files (Pass 2),
# installs only what's needed. All tools pulled from official sources — nothing
# pre-staged in S3. Idempotent — skips tools already present.
#
# Usage:
#   /app/install-tools.sh              # Pass 1 only (env vars, no repo)
#   /app/install-tools.sh /workspace/repo  # Pass 1 + Pass 2 (env vars + repo files)

REPO_DIR="${1:-}"
INSTALLED=""

# Pre-extend PATH for cached tool installations.
# Docker volume mounts may already contain tools from previous runs —
# this ensures `command -v` finds them without re-installation.
export PATH="/usr/local/go/bin:$HOME/.cargo/bin:$HOME/.deno/bin:$HOME/.bun/bin:${PATH}"

log() { echo "[install-tools] $*"; }

# ── Detection Helpers ────────────────────────────────────────────────────────

need_go() {
  if echo "${TASK_DESCRIPTION:-}" | grep -qiE '\bgo\b|golang|go service|go module'; then
    return 0
  fi
  # Quality gate commands like "go vet", "go test", "go build" are a clear signal
  if echo "${QUALITY_GATE_COMMANDS:-}" | grep -qiE '\bgo vet\b|\bgo test\b|\bgo build\b|\bgofmt\b|\bgolang\b'; then
    return 0
  fi
  if [ -n "$REPO_DIR" ] && [ -f "$REPO_DIR/go.mod" ]; then
    return 0
  fi
  return 1
}

need_terraform() {
  if [ "${WORKER_PERSONA:-}" = "devops_engineer" ]; then return 0; fi
  if echo "${TASK_DESCRIPTION:-}" | grep -qiE 'terraform|infrastructure as code'; then
    return 0
  fi
  if [ -n "$REPO_DIR" ] && find "$REPO_DIR" -maxdepth 3 -name '*.tf' -print -quit 2>/dev/null | grep -q .; then
    return 0
  fi
  return 1
}

need_awscli() {
  if [ "${WORKER_PERSONA:-}" = "devops_engineer" ]; then return 0; fi
  if [ "${DEPLOYMENT_ENABLED:-}" = "true" ]; then return 0; fi
  return 1
}

# Returns target Node.js major version if upgrade needed, empty string otherwise.
# Checks package.json engines, .nvmrc, .node-version files for a required version
# higher than the currently installed major version.
detect_node_upgrade() {
  local current_major
  current_major=$(node --version 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')
  [ -z "$current_major" ] && return

  local target=""

  # Check .nvmrc or .node-version in repo root
  if [ -n "$REPO_DIR" ]; then
    for f in .nvmrc .node-version; do
      if [ -f "$REPO_DIR/$f" ]; then
        target=$(head -1 "$REPO_DIR/$f" 2>/dev/null | tr -d 'v \n\r' | sed 's/\([0-9]*\).*/\1/')
        break
      fi
    done

    # Check root package.json engines.node (e.g. ">=22", "22", "^22")
    if [ -z "$target" ] && [ -f "$REPO_DIR/package.json" ]; then
      target=$(grep -oP '"node"\s*:\s*"[^"]*"' "$REPO_DIR/package.json" 2>/dev/null \
        | grep -oP '[0-9]+' | head -1)
    fi
  fi

  # Only upgrade if target is higher than current
  if [ -n "$target" ] && [ "$target" -gt "$current_major" ] 2>/dev/null; then
    echo "$target"
  fi
}

# ── Install Functions (all pull from official sources) ───────────────────────
# Note: Kaniko is baked into the Docker image (no standalone download exists).

install_go() {
  if command -v go &>/dev/null; then
    log "Go already installed ($(go version))"
    return 0
  fi
  log "Installing Go 1.24.1 from go.dev..."
  curl -fsSL https://go.dev/dl/go1.24.1.linux-amd64.tar.gz -o /tmp/go.tar.gz
  sudo tar -C /usr/local -xzf /tmp/go.tar.gz
  rm -f /tmp/go.tar.gz
  export PATH="/usr/local/go/bin:${PATH}"
  export GOPATH="/home/worker/go"
  export GOMODCACHE="/home/worker/go/pkg/mod"
  log "Go installed: $(go version)"
  INSTALLED="${INSTALLED} go"
}

install_terraform() {
  if command -v terraform &>/dev/null; then
    log "Terraform already installed ($(terraform --version | head -1))"
    return 0
  fi
  log "Installing Terraform 1.9.8 from releases.hashicorp.com..."
  curl -fsSL https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip -o /tmp/terraform.zip
  sudo unzip -o /tmp/terraform.zip -d /usr/local/bin
  rm -f /tmp/terraform.zip
  log "Terraform installed: $(terraform --version | head -1)"
  INSTALLED="${INSTALLED} terraform"
}

install_awscli() {
  if command -v aws &>/dev/null; then
    log "AWS CLI already installed ($(aws --version))"
    return 0
  fi
  log "Installing AWS CLI v2 from awscli.amazonaws.com..."
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  cd /tmp && unzip -o awscliv2.zip
  sudo /tmp/aws/install
  rm -rf /tmp/awscliv2.zip /tmp/aws
  cd - >/dev/null
  log "AWS CLI installed: $(aws --version)"
  INSTALLED="${INSTALLED} awscli"
}

install_rust() {
  local version="${1:-stable}"
  if command -v rustc &>/dev/null; then
    log "Rust already installed ($(rustc --version))"
    return 0
  fi
  log "Installing Rust ${version} from rustup.rs..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain "${version}" 2>/dev/null
  export PATH="$HOME/.cargo/bin:${PATH}"
  log "Rust installed: $(rustc --version)"
  INSTALLED="${INSTALLED} rust"
}

install_deno() {
  local version="${1:-}"
  if command -v deno &>/dev/null; then
    log "Deno already installed ($(deno --version | head -1))"
    return 0
  fi
  log "Installing Deno ${version:-latest} from deno.land..."
  curl -fsSL https://deno.land/install.sh | sh -s -- ${version:+v$version} 2>/dev/null
  export PATH="$HOME/.deno/bin:${PATH}"
  log "Deno installed: $(deno --version | head -1)"
  INSTALLED="${INSTALLED} deno"
}

install_bun() {
  if command -v bun &>/dev/null; then
    log "Bun already installed ($(bun --version))"
    return 0
  fi
  log "Installing Bun from bun.sh..."
  curl -fsSL https://bun.sh/install | bash 2>/dev/null
  export PATH="$HOME/.bun/bin:${PATH}"
  log "Bun installed: $(bun --version)"
  INSTALLED="${INSTALLED} bun"
}

install_railway() {
  if command -v railway &>/dev/null; then
    log "Railway CLI already installed ($(railway --version))"
    return 0
  fi
  log "Installing Railway CLI..."
  curl -fsSL https://railway.com/install.sh | sh 2>/dev/null
  log "Railway CLI installed: $(railway --version 2>/dev/null || echo 'unknown')"
  INSTALLED="${INSTALLED} railway"
}

install_node_version() {
  local target_version="$1"
  local current_major
  current_major=$(node --version 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')
  local target_major
  target_major=$(echo "$target_version" | sed 's/\([0-9]*\).*/\1/')

  if [ "$current_major" = "$target_major" ]; then
    log "Node.js $target_major already installed ($(node --version))"
    return 0
  fi

  log "Upgrading Node.js from v${current_major} to v${target_major}..."
  # Use NodeSource for major version upgrades
  curl -fsSL "https://deb.nodesource.com/setup_${target_major}.x" | sudo -E bash - 2>/dev/null
  sudo apt-get install -y -qq nodejs 2>/dev/null
  log "Node.js upgraded: $(node --version)"
  INSTALLED="${INSTALLED} node${target_major}"
}

# ── Dynamic Fallback (Pass 3) ────────────────────────────────────────────────
# Scans Makefiles, CI configs, etc. for tool references that Pass 1/2 missed.

fallback_scan() {
  [ -z "$REPO_DIR" ] && return

  local scan_text=""
  for f in Makefile Makefile.* .github/workflows/*.yml .gitlab-ci.yml Jenkinsfile README.md docker-compose*.yml; do
    local full="$REPO_DIR/$f"
    for match in $full; do
      [ -f "$match" ] && scan_text+=$(head -c 50000 "$match" 2>/dev/null)$'\n'
    done
  done

  if ! command -v go &>/dev/null; then
    if echo "$scan_text" | grep -qiE 'go build|go test|go run|setup-go|golang'; then
      log "Fallback: detected Go references in config files"
      install_go
    fi
  fi

  if ! command -v terraform &>/dev/null; then
    if echo "$scan_text" | grep -qiE 'terraform plan|terraform apply|setup-terraform|hashicorp/terraform'; then
      log "Fallback: detected Terraform references in config files"
      install_terraform
    fi
  fi

  if ! command -v aws &>/dev/null; then
    if echo "$scan_text" | grep -qiE 'aws ecs|aws s3|aws ecr|aws-actions|configure-aws-credentials'; then
      log "Fallback: detected AWS CLI references in config files"
      install_awscli
    fi
  fi

  if ! command -v rustc &>/dev/null; then
    if echo "$scan_text" | grep -qiE 'cargo build|cargo test|rustup|actions/setup-rust|rust-toolchain'; then
      log "Fallback: detected Rust references in config files"
      install_rust
    fi
  fi

  if ! command -v deno &>/dev/null; then
    if echo "$scan_text" | grep -qiE 'deno run|deno task|denoland/setup-deno'; then
      log "Fallback: detected Deno references in config files"
      install_deno
    fi
  fi

  if ! command -v railway &>/dev/null; then
    if echo "$scan_text" | grep -qiE 'railway up|railway deploy|railway run|railwayapp'; then
      log "Fallback: detected Railway CLI references in config files"
      install_railway
    fi
  fi

  # Check CI configs for Node.js version requirements higher than current
  local ci_node_version
  ci_node_version=$(echo "$scan_text" | grep -oP 'node-version:\s*"?\K[0-9]+' | sort -rn | head -1)
  if [ -n "$ci_node_version" ]; then
    local current_major
    current_major=$(node --version 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')
    if [ -n "$current_major" ] && [ "$ci_node_version" -gt "$current_major" ] 2>/dev/null; then
      log "Fallback: CI requires Node.js $ci_node_version (currently v$current_major)"
      install_node_version "$ci_node_version"
    fi
  fi
}

# ── Pass 4: .tool-versions / mise.toml parser ───────────────────────────────
# Repos using asdf or mise declare exact tool+version requirements.

resolve_tool() {
  local tool="$1"
  local version="$2"
  case "$tool" in
    golang|go)       install_go ;;
    terraform)       install_terraform ;;
    awscli|aws-cli)  install_awscli ;;
    rust|rustup)     install_rust "$version" ;;
    deno)            install_deno "$version" ;;
    bun)             install_bun ;;
    railway)         install_railway ;;
    python)          ;; # Python 3 already in base image
    nodejs|node)     [ -n "$version" ] && install_node_version "$version" ;;
    *)
      # Unknown tool — try apt as generic fallback
      try_apt_install "$tool"
      ;;
  esac
}

parse_tool_versions() {
  [ -z "$REPO_DIR" ] && return
  local tv_file=""

  if [ -f "$REPO_DIR/.tool-versions" ]; then
    tv_file="$REPO_DIR/.tool-versions"
  elif [ -f "$REPO_DIR/mise.toml" ]; then
    log "Detected mise.toml — parsing tool declarations"
    grep -E '^[a-z]' "$REPO_DIR/mise.toml" 2>/dev/null | while IFS='=' read -r tool version; do
      tool=$(echo "$tool" | tr -d ' "')
      version=$(echo "$version" | tr -d ' "')
      [ -n "$tool" ] && resolve_tool "$tool" "$version"
    done
    return
  else
    return
  fi

  log "Detected .tool-versions — parsing tool declarations"
  while IFS=' ' read -r tool version _rest; do
    [[ "$tool" =~ ^#.*$ ]] && continue
    [ -z "$tool" ] && continue
    resolve_tool "$tool" "$version"
  done < "$tv_file"
}

# ── Generic apt fallback ─────────────────────────────────────────────────────
# Last resort for tools not handled above. Maps common names to apt packages.
# For anything truly exotic (no apt package), Claude CLI can use sudo apt-get
# at runtime since it's in sudoers.

APT_UPDATED=false

try_apt_install() {
  local tool="$1"
  command -v "$tool" &>/dev/null && return 0

  local pkg=""
  case "$tool" in
    make)       pkg="build-essential" ;;
    gcc|g++)    pkg="build-essential" ;;
    cmake)      pkg="cmake" ;;
    ruby)       pkg="ruby-full" ;;
    php)        pkg="php-cli" ;;
    java|javac) pkg="default-jdk-headless" ;;
    mvn|maven)  pkg="maven" ;;
    gradle)     pkg="gradle" ;;
    protoc)     pkg="protobuf-compiler" ;;
    sqlite3)    pkg="sqlite3" ;;
    redis-cli)  pkg="redis-tools" ;;
    psql)       pkg="postgresql-client" ;;
    ffmpeg)     pkg="ffmpeg" ;;
    imagemagick|convert) pkg="imagemagick" ;;
    *)          pkg="$tool" ;;  # Assume package name = tool name
  esac

  if [ -z "$pkg" ]; then
    log "No apt package known for '$tool' — Claude CLI can install at runtime via sudo apt-get"
    return 0
  fi

  if ! $APT_UPDATED; then
    sudo apt-get update -qq 2>/dev/null
    APT_UPDATED=true
  fi

  if apt-cache show "$pkg" &>/dev/null; then
    log "Installing '$pkg' via apt (for tool '$tool')..."
    sudo apt-get install -y -qq "$pkg" 2>/dev/null
    INSTALLED="${INSTALLED} ${tool}(apt)"
  else
    log "Package '$pkg' not found in apt — Claude CLI can install at runtime"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

# Pass 1+2: known tools with custom installers (env vars + repo files)
need_go && install_go
need_terraform && install_terraform
need_awscli && install_awscli

# Pass 2b: Node.js version upgrade (if repo declares a higher version than installed)
NODE_TARGET=$(detect_node_upgrade)
if [ -n "$NODE_TARGET" ]; then
  install_node_version "$NODE_TARGET"
fi

# Pass 3: scan config files for references we missed
fallback_scan

# Pass 4: honor explicit .tool-versions / mise.toml declarations
parse_tool_versions

if [ -n "$INSTALLED" ]; then
  log "Installed:${INSTALLED}"
else
  log "No additional tools needed"
fi
