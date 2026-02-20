#!/bin/sh
# WorkerMill Agent Installer
# Usage: curl -fsSL https://workermill.com/install.sh | bash
set -e

CDN_BASE="https://workermill.com/agent/latest"
INSTALL_DIR="$HOME/.workermill/bin"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux)  PLATFORM="linux" ;;
  darwin) PLATFORM="darwin" ;;
  *)      echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)             echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

BINARY_NAME="workermill-agent-${PLATFORM}-${ARCH}"

echo "Installing WorkerMill Agent (${PLATFORM}-${ARCH})..."

# Download
mkdir -p "$INSTALL_DIR"
curl -fsSL "${CDN_BASE}/${BINARY_NAME}" -o "$INSTALL_DIR/workermill-agent"
chmod +x "$INSTALL_DIR/workermill-agent"

# Add to PATH
SHELL_NAME=$(basename "$SHELL")
PROFILE=""
case "$SHELL_NAME" in
  zsh)  PROFILE="$HOME/.zshrc" ;;
  bash) PROFILE="$HOME/.bashrc" ;;
  fish) PROFILE="$HOME/.config/fish/config.fish" ;;
esac

if [ -n "$PROFILE" ] && ! grep -q ".workermill/bin" "$PROFILE" 2>/dev/null; then
  if [ "$SHELL_NAME" = "fish" ]; then
    echo "set -gx PATH \$HOME/.workermill/bin \$PATH" >> "$PROFILE"
  else
    echo 'export PATH="$HOME/.workermill/bin:$PATH"' >> "$PROFILE"
  fi
  echo "Added ~/.workermill/bin to PATH in $PROFILE"
fi

echo ""
echo "WorkerMill Agent installed to $INSTALL_DIR/workermill-agent"
echo ""
echo "Run 'workermill-agent' to get started (you may need to restart your shell)."
