***REMOVED***!/bin/bash
***REMOVED*** WorkerMill Runtime Tool Installer
***REMOVED*** Detects required tools from env vars (Pass 1) and repo files (Pass 2),
***REMOVED*** installs only what's needed. All tools pulled from official sources — nothing
***REMOVED*** pre-staged in S3. Idempotent — skips tools already present.
***REMOVED***
***REMOVED*** Usage:
***REMOVED***   /app/install-tools.sh              ***REMOVED*** Pass 1 only (env vars, no repo)
***REMOVED***   /app/install-tools.sh /workspace/repo  ***REMOVED*** Pass 1 + Pass 2 (env vars + repo files)

REPO_DIR="${1:-}"
INSTALLED=""

***REMOVED*** Pre-extend PATH for cached tool installations.
***REMOVED*** Docker volume mounts may already contain tools from previous runs —
***REMOVED*** this ensures `command -v` finds them without re-installation.
export PATH="/usr/local/go/bin:$HOME/.cargo/bin:$HOME/.deno/bin:$HOME/.bun/bin:${PATH}"

log() { echo "[install-tools] $*"; }

***REMOVED*** ── Detection Helpers ────────────────────────────────────────────────────────

need_go() {
  if echo "${TASK_DESCRIPTION:-}" | grep -qiE '\bgo\b|golang|go service|go module'; then
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

***REMOVED*** ── Install Functions (all pull from official sources) ───────────────────────
***REMOVED*** Note: Kaniko is baked into the Docker image (no standalone download exists).

install_go() {
  if command -v go &>/dev/null; then
    log "Go already installed ($(go version))"
    return 0
  fi
  log "Installing Go 1.23.6 from go.dev..."
  curl -fsSL https://go.dev/dl/go1.23.6.linux-amd64.tar.gz -o /tmp/go.tar.gz
  sudo tar -C /usr/local -xzf /tmp/go.tar.gz
  rm -f /tmp/go.tar.gz
  export PATH="/usr/local/go/bin:${PATH}"
  export GOPATH="/home/worker/go"
  export GOMODCACHE="/home/worker/go/pkg/mod"
  log "Go installed: $(go version)"

  ***REMOVED*** Also install golangci-lint
  if ! command -v golangci-lint &>/dev/null; then
    log "Installing golangci-lint from GitHub..."
    curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/HEAD/install.sh | sh -s -- -b /tmp/golangci-lint-bin v1.63.4
    sudo install -m 755 /tmp/golangci-lint-bin/golangci-lint /usr/local/bin/golangci-lint
    rm -rf /tmp/golangci-lint-bin
    log "golangci-lint installed: $(golangci-lint --version)"
  fi
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

***REMOVED*** ── Dynamic Fallback (Pass 3) ────────────────────────────────────────────────
***REMOVED*** Scans Makefiles, CI configs, etc. for tool references that Pass 1/2 missed.

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
}

***REMOVED*** ── Pass 4: .tool-versions / mise.toml parser ───────────────────────────────
***REMOVED*** Repos using asdf or mise declare exact tool+version requirements.

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
    python)          ;; ***REMOVED*** Python 3 already in base image
    nodejs|node)     ;; ***REMOVED*** Node 20 already in base image
    *)
      ***REMOVED*** Unknown tool — try apt as generic fallback
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
    [[ "$tool" =~ ^***REMOVED***.*$ ]] && continue
    [ -z "$tool" ] && continue
    resolve_tool "$tool" "$version"
  done < "$tv_file"
}

***REMOVED*** ── Generic apt fallback ─────────────────────────────────────────────────────
***REMOVED*** Last resort for tools not handled above. Maps common names to apt packages.
***REMOVED*** For anything truly exotic (no apt package), Claude CLI can use sudo apt-get
***REMOVED*** at runtime since it's in sudoers.

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
    *)          pkg="$tool" ;;  ***REMOVED*** Assume package name = tool name
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

***REMOVED*** ── Main ─────────────────────────────────────────────────────────────────────

***REMOVED*** Pass 1+2: known tools with custom installers (env vars + repo files)
need_go && install_go
need_terraform && install_terraform
need_awscli && install_awscli

***REMOVED*** Pass 3: scan config files for references we missed
fallback_scan

***REMOVED*** Pass 4: honor explicit .tool-versions / mise.toml declarations
parse_tool_versions

if [ -n "$INSTALLED" ]; then
  log "Installed:${INSTALLED}"
else
  log "No additional tools needed"
fi
