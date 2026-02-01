#!/bin/bash
# =============================================================================
# GitHub Actions Self-Hosted Runner Setup Script
# =============================================================================
#
# This script runs on first boot to:
# 1. Install dependencies (Docker, Node.js, Git, Playwright deps)
# 2. Install and configure the GitHub Actions runner
# 3. Start the runner as a systemd service
#
# The runner token is retrieved from AWS SSM Parameter Store.
# =============================================================================

set -euo pipefail

# Logging
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1
echo "Starting GitHub Actions runner setup..."

# =============================================================================
# Install System Dependencies
# =============================================================================
echo "Installing system dependencies..."
dnf update -y
dnf install -y \
  docker \
  git \
  jq \
  tar \
  gzip \
  unzip \
  which \
  libicu \
  openssl-devel \
  amazon-cloudwatch-agent

# Start Docker
systemctl enable docker
systemctl start docker

# =============================================================================
# Install Node.js
# =============================================================================
echo "Installing Node.js ${node_version}..."
dnf install -y nodejs${node_version}
npm install -g npm@latest

# Verify Node.js installation
node --version
npm --version

# =============================================================================
# Install Playwright Dependencies
# =============================================================================
echo "Installing Playwright browser dependencies..."
# Install Chromium dependencies
dnf install -y \
  alsa-lib \
  atk \
  cups-libs \
  gtk3 \
  libXcomposite \
  libXcursor \
  libXdamage \
  libXext \
  libXi \
  libXrandr \
  libXScrnSaver \
  libXtst \
  pango \
  xdg-utils \
  nss \
  nspr \
  libdrm \
  mesa-libgbm \
  libxkbcommon

# =============================================================================
# Create Runner User
# =============================================================================
echo "Creating runner user..."
useradd -m -s /bin/bash runner || true
usermod -aG docker runner

# =============================================================================
# Install GitHub Actions Runner
# =============================================================================
echo "Installing GitHub Actions runner v${runner_version}..."
RUNNER_DIR="/opt/actions-runner"
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# Download runner
curl -o actions-runner-linux-x64-${runner_version}.tar.gz -L \
  "https://github.com/actions/runner/releases/download/v${runner_version}/actions-runner-linux-x64-${runner_version}.tar.gz"

# Extract
tar xzf actions-runner-linux-x64-${runner_version}.tar.gz
rm actions-runner-linux-x64-${runner_version}.tar.gz

# Set ownership
chown -R runner:runner "$RUNNER_DIR"

# =============================================================================
# Configure Runner
# =============================================================================
echo "Configuring runner..."

# Retrieve runner token from SSM Parameter Store
TOKEN=$(aws ssm get-parameter \
  --name "${ssm_token_param_name}" \
  --with-decryption \
  --query "Parameter.Value" \
  --output text \
  --region "${aws_region}") || {
    echo "ERROR: Failed to retrieve runner token from SSM"
    echo "Please ensure the parameter ${ssm_token_param_name} exists"
    exit 1
  }

# Configure runner as the runner user
su - runner -c "cd $RUNNER_DIR && ./config.sh \
  --url https://github.com/${github_org}/${github_repo} \
  --token '$TOKEN' \
  --name '${runner_name}' \
  --labels '${runner_labels}' \
  --unattended \
  --replace"

# =============================================================================
# Install Runner as Service
# =============================================================================
echo "Installing runner as systemd service..."
cd "$RUNNER_DIR"
./svc.sh install runner
./svc.sh start

# =============================================================================
# Install Playwright Browsers (as runner user)
# =============================================================================
echo "Installing Playwright browsers..."
su - runner -c "cd /tmp && npm init -y && npx playwright install chromium"

# =============================================================================
# Verification
# =============================================================================
echo "Verifying installation..."
systemctl status actions.runner.* --no-pager || true
echo "GitHub Actions runner setup complete!"
