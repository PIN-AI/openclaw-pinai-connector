# PINAI Connector for OpenClaw

Connect your desktop to PINAI mobile app via OpenClaw.

## 🚀 Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/PINAI/openclaw-pinai-connector/main/install.sh | bash
```

Or manually:

```bash
mkdir -p ~/.openclaw/extensions
cd ~/.openclaw/extensions
git clone https://github.com/PINAI/openclaw-pinai-connector.git pinai-connector
cd pinai-connector
npm install
```

Then restart OpenClaw:

```bash
openclaw gateway restart
```

## 📋 Prerequisites

- **OpenClaw** >= 2026.2.0 ([Install OpenClaw](https://openclaw.ai))
- **PINAI Mobile App** ([Download](https://pinai.tech))
- **Node.js** >= 18

## ✨ Features

- 🔐 **QR Code Authentication** - Secure device pairing
- 💓 **Automatic Heartbeat** - Maintains connection (30s interval)
- 📡 **Command Execution** - Receive and execute AI prompts from mobile
- 🔄 **Auto-reconnect** - Restores connection on restart
- 🤖 **AI Integration** - Uses OpenClaw's embedded agent
- 📊 **Work Context** - Reports work summaries every 6 hours

## 🎯 How It Works

1. Install this plugin in OpenClaw
2. Start OpenClaw gateway
3. Open PINAI mobile app
4. Scan the QR code displayed in terminal
5. Send commands from your phone to your desktop!

## ⚙️ Configuration (Optional)

Add to your OpenClaw config (`~/.openclaw/openclaw.json`):

```json
{
  "plugins": {
    "pinai-connector": {
      "enabled": true,
      "backendUrl": "https://dev-mining.api.pinai.tech",
      "heartbeatIntervalMs": 30000,
      "qrCodeTimeoutMs": 300000,
      "showQrCode": true,
      "verbose": true
    }
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the connector |
| `backendUrl` | string | `https://dev-mining.api.pinai.tech` | PINAI backend API URL |
| `heartbeatIntervalMs` | number | `30000` | Heartbeat interval (ms) |
| `qrCodeTimeoutMs` | number | `300000` | QR code expiration (ms) |
| `showQrCode` | boolean | `true` | Display QR in console |
| `verbose` | boolean | `true` | Enable detailed logging |

## Usage

### First Time Setup

1. Start OpenClaw gateway:
   ```bash
   openclaw gateway run
   ```

2. A QR code will be displayed in the console

3. Open PINAI mobile app and scan the QR code

4. Connection is established and persisted

### Subsequent Starts

The plugin automatically restores the connection from saved registration. No QR code needed.

## Gateway Methods

The plugin registers these gateway methods:

- `desktop-connector.generate-qr` - Generate new QR code
- `desktop-connector.status` - Get connection status
- `desktop-connector.disconnect` - Disconnect from backend

## Architecture

```
extensions/pinai-connector/
├── package.json              # Plugin metadata
├── openclaw.plugin.json      # Plugin manifest
├── index.ts                  # Plugin entry point
├── README.md                 # This file
└── src/
    ├── connector-manager.ts  # Core connection logic
    ├── types.ts              # TypeScript types
    ├── constants.ts          # Configuration constants
    ├── device-id.ts          # Device identification
    ├── registration-store.ts # Persistent storage
    ├── work-context-collector.ts # Work summaries
    ├── qr-generator.ts       # QR code generation
    ├── api-client.ts         # Backend API client
    ├── error-handler.ts      # Error handling
    └── logger.ts             # Logging utilities
```

## How It Works

1. **QR Generation**: Plugin generates QR token via backend API
2. **Mobile Scan**: User scans QR with PINAI app
3. **Registration**: Backend registers the connection
4. **Persistence**: Registration saved to `~/.openclaw/pinai-connector-registration.json`
5. **Heartbeat**: Plugin sends heartbeat every 30 seconds
6. **Command Polling**: Plugin polls for commands every 5 seconds
7. **AI Execution**: Commands are executed using OpenClaw's embedded agent
8. **Result Reporting**: Results sent back to backend

## Backend API

The plugin communicates with these endpoints:

- `POST /connector/pinai/qr-token` - Generate QR token
- `GET /connector/pinai/check-login-status` - Poll for registration
- `POST /connector/pinai/register` - Register connector
- `POST /connector/pinai/heartbeat` - Send heartbeat
- `GET /connector/pinai/commands/poll` - Poll for commands
- `POST /connector/pinai/commands/result` - Report results
- `POST /connector/pinai/work-context` - Report work summary
- `POST /connector/pinai/disconnect` - Disconnect

## Security

- QR tokens expire after 5 minutes
- Single-use tokens
- Device ID based on MAC address hash (privacy-preserving)
- All communication via HTTPS
- Registration persisted locally for auto-reconnect

## Troubleshooting

### QR Code Not Displaying

Check that `showQrCode` is `true` in config and `qrcode-terminal` is installed.

### Connection Fails

1. Verify backend URL is accessible
2. Check network connectivity
3. Review logs for errors

### Commands Not Received

1. Ensure heartbeat is running (check logs)
2. Verify connector status is "connected"
3. Check command polling interval

## Development

### Testing Locally

```bash
# Build OpenClaw
cd openclaw
pnpm build

# Run gateway
pnpm openclaw gateway run
```

### Debugging

Enable verbose logging in config:

```json
{
  "plugins": {
    "pinai-connector": {
      "verbose": true
    }
  }
}
```

## License

Part of the OpenClaw project.
