#!/usr/bin/env bash
# RemoteForge VPS Agent — one-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/erenxkuki/RemoteForge/main/packages/remoteforge/install.sh | bash
set -e

echo ""
echo "  ╔══════════════════════════════════╗"
echo "  ║   RemoteForge VPS Agent Installer  ║"
echo "  ╚══════════════════════════════════╝"
echo ""

# Check/install Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "[1/3] Node.js not found. Installing Node.js 20 LTS..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null 2>&1
    sudo apt-get install -y nodejs >/dev/null 2>&1
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - >/dev/null 2>&1
    sudo yum install -y nodejs >/dev/null 2>&1
  else
    echo "ERROR: Please install Node.js 20+ manually: https://nodejs.org"
    exit 1
  fi
fi

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required (found $(node -v))."
  exit 1
fi
echo "[1/3] Node.js $(node -v) OK"

# Install agent via npx
echo "[2/3] Downloading RemoteForge agent..."
mkdir -p "$HOME/.remoteforge-agent"
npx -y remote-forge-cli@latest --version >/dev/null 2>&1 || true

# Download bundled agent.js
AGENT_URL="https://raw.githubusercontent.com/erenxkuki/RemoteForge/main/packages/remoteforge/agent.js"
if curl -fsSL "$AGENT_URL" -o "$HOME/.remoteforge-agent/agent.js" 2>/dev/null; then
  echo "[2/3] Agent downloaded"
else
  # Fallback: clone repo
  echo "[2/3] Downloading from GitHub..."
  rm -rf "$HOME/RemoteForge"
  git clone --depth 1 https://github.com/erenxkuki/RemoteForge.git "$HOME/RemoteForge" >/dev/null 2>&1
  cp "$HOME/RemoteForge/packages/agent/dist/index.js" "$HOME/.remoteforge-agent/agent.js" 2>/dev/null || \
  (cd "$HOME/RemoteForge" && npm run build >/dev/null 2>&1 && cp packages/agent/dist/index.js "$HOME/.remoteforge-agent/agent.js")
  echo "[2/3] Agent built"
fi

# Create wrapper
cat > "$HOME/.remoteforge-agent/remoteforge-agent" <<'EOF'
#!/usr/bin/env bash
node "$HOME/.remoteforge-agent/agent.js" "$@"
EOF
chmod +x "$HOME/.remoteforge-agent/remoteforge-agent"

# Add to PATH
if ! echo "$PATH" | grep -q "$HOME/.remoteforge-agent"; then
  echo "export PATH=\"$HOME/.remoteforge-agent:\$PATH\"" >> "$HOME/.bashrc"
  echo "export PATH=\"$HOME/.remoteforge-agent:\$PATH\"" >> "$HOME/.profile" 2>/dev/null || true
  export PATH="$HOME/.remoteforge-agent:$PATH"
fi

echo "[3/3] Done!"
echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║  Installation complete!                      ║"
echo "  ╠══════════════════════════════════════════════╣"
echo "  ║  Next: remoteforge-agent pair --server URL   ║"
echo "  ║        remoteforge-agent run                 ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""
echo "Run now:"
echo "  remoteforge-agent pair --server http://YOUR_SERVER_IP:8787 --name myvps"
echo ""