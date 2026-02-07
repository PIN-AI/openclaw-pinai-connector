#!/bin/bash
set -e

echo "🚀 Installing PINAI Connector for OpenClaw..."
echo ""

# Check if OpenClaw is installed
if ! command -v openclaw &> /dev/null; then
    echo "❌ OpenClaw not found!"
    echo ""
    echo "Please install OpenClaw first:"
    echo "  npm install -g openclaw"
    echo ""
    echo "Or visit: https://openclaw.ai"
    exit 1
fi

echo "✅ OpenClaw found: $(openclaw --version)"
echo ""

# Determine plugin directory
PLUGIN_DIR="${HOME}/.openclaw/extensions/pinai-connector"

# Create extensions directory if it doesn't exist
mkdir -p "${HOME}/.openclaw/extensions"

# Clone or update plugin
if [ -d "$PLUGIN_DIR" ]; then
    echo "📦 Updating existing PINAI Connector..."
    cd "$PLUGIN_DIR"
    git pull
else
    echo "📦 Installing PINAI Connector..."
    git clone https://github.com/PINAI/openclaw-pinai-connector.git "$PLUGIN_DIR"
    cd "$PLUGIN_DIR"
fi

# Install dependencies
echo ""
echo "📥 Installing dependencies..."
npm install

echo ""
echo "✅ PINAI Connector installed successfully!"
echo ""
echo "📱 Next steps:"
echo "  1. Restart OpenClaw gateway:"
echo "     openclaw gateway restart"
echo ""
echo "  2. Open PINAI App and scan the QR code"
echo ""
echo "  3. Start using Desktop Connector!"
echo ""
