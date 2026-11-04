#!/usr/bin/env bash
# RemoteForge VPS Agent — one-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/erenxkuki/RemoteForge/main/packages/remoteforge/install.sh | bash
set -e

echo "=== RemoteForge VPS Agent Installer ==="

# Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Installing Node.js 20 LTS..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs
  else
    echo "Please install Node.js 20+ manually: https://nodejs.org"
    exit 1
  fi
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "Node.js 20+ required (found v$(node -v)). Please upgrade."
  exit 1
fi

echo "Node.js $(node -v) OK"

# Install agent
INSTALL_DIR="$HOME/.remoteforge-agent"
mkdir -p "$INSTALL_DIR"

echo "Downloading RemoteForge agent..."
curl -fsSL "https://registry.npmjs.org/remote-forge-cli/latest" -o /dev/null 2>/dev/null || true

# Try npx first
if command -v npx >/dev/null 2>&1; then
  echo "Installing via npx..."
  npx -y remote-forge-cli@latest --version >/dev/null 2>&1 || true
fi

# Fallback: download bundled agent.js from GitHub
AGENT_URL="https://raw.githubusercontent.com/erenxkuki/RemoteForge/main/packages/remoteforge/agent.js"
if curl -fsSL "$AGENT_URL" -o "$INSTALL_DIR/agent.js" 2>/dev/null; then
  echo "Agent downloaded to $INSTALL_DIR/agent.js"
else
  echo "Could not download agent. Please clone the repo manually."
  exit 1
fi

# Create wrapper
cat > "$INSTALL_DIR/remoteforge-agent" <<'EOF'
#!/usr/bin/env bash
node "$HOME/.remoteforge-agent/agent.js" "$@"
EOF
chmod +x "$INSTALL_DIR/remoteforge-agent"

# Add to PATH
if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
  echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$HOME/.bashrc"
  echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$HOME/.profile" 2>/dev/null || true
  export PATH="$INSTALL_DIR:$PATH"
fi

echo ""
echo "=== Installation complete ==="
echo "Run: remoteforge-agent pair --server <SERVER_URL> --name myvps"
echo "Then approve the pairing from your control machine."
echo ""