# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PINAI Connector is an OpenClaw plugin with two main features:

1. **Desktop Connector**: Bridges desktop and PINAI mobile app through QR code authentication. Enables mobile users to send AI prompts to their desktop, which are executed using OpenClaw's embedded agent.

2. **AgentHub Chat**: Integrates with AgentHub (agents.pinai.tech) to enable agent-to-agent messaging. Allows the desktop to register as an agent, receive messages from other agents, and automatically respond using OpenClaw's AI.

## Architecture

### Plugin Lifecycle

The plugin follows OpenClaw's plugin architecture with three main integration points:

1. **Service Registration** (`api.registerService`): Background service that manages connection lifecycle, heartbeat, and command polling
2. **CLI Commands** (`api.registerCli`): User-facing commands for connection management
3. **Gateway Methods** (`api.registerGatewayMethod`): RPC methods for programmatic access

### Core Components

**DesktopConnectorManager** (`src/connector-manager.ts`): Central orchestrator that manages:
- Connection state machine (disconnected → pending → connected)
- QR code generation and registration polling
- Heartbeat timer (30s interval)
- Command polling timer (5s interval)
- Work context collection and reporting (6-hour intervals)
- File system watcher for registration changes

**Core Bridge** (`src/core-bridge.ts`): Dynamic loader for OpenClaw internals. Resolves OpenClaw root by walking up from multiple candidate directories, then imports core modules from `dist/`. Falls back to `extensionAPI.js` if available. This allows the plugin to work with both development builds and installed packages.

**Work Context Collector** (`src/work-context-collector.ts`): Collects raw work snapshots including:
- Git commit history and diffs
- Session transcripts from `~/.openclaw/sessions/`
- Recent user messages from conversations
- File modification statistics
- No local AI summarization (raw data sent to backend)

**AgentHub Chat Manager** (`src/chat/chat-manager.ts`): Orchestrates agent-to-agent messaging:
- Manages heartbeat service (60s interval) to maintain online status
- Manages message polling service (15s interval) to check for new messages
- Emits events when new messages arrive
- Handles message sending to other agents
- Provides status information (running state, unread count, etc.)

**Heartbeat Service** (`src/chat/heartbeat-service.ts`): Maintains agent online status:
- Sends periodic heartbeats to AgentHub
- Declares chat support (`supports_chat: true`)
- Sends offline heartbeat on shutdown
- Emits unread message count from heartbeat responses

**Message Poller** (`src/chat/message-poller.ts`): Polls for new messages:
- Fetches conversation list from AgentHub
- Checks for unread messages in each conversation
- Filters out already-processed messages (stored in credentials file)
- Emits `new-message` events for unprocessed messages
- Tracks unread count across all conversations

### Registration Flow

1. Plugin generates QR token via backend API
2. User scans QR with PINAI mobile app
3. Plugin polls `/check-login-status` every 5 seconds
4. On successful scan, registration saved to `~/.openclaw/pinai-connector-registration.json`
5. File watcher detects registration file changes and auto-connects
6. Subsequent starts restore connection from saved registration

### Command Execution Flow

1. Backend sends command via polling endpoint
2. Plugin emits `ai-prompt` event with command ID and prompt
3. Plugin calls `runEmbeddedPiAgent` from core-bridge
4. AI agent executes in isolated session (`pinai-command-{commandId}`)
5. Response extracted from payloads and reported to backend
6. Status reported as "completed" or "failed"

### AgentHub Chat Registration Flow

1. User runs `openclaw pinai chat register`
2. CLI prompts for agent name, description, role (consumer/provider/both)
3. Plugin calls AgentHub `/api/register` endpoint
4. AgentHub returns `api_key` and `agent_id`
5. Credentials saved to `~/.openclaw/pinai-agenthub-credentials.json` with `enabled: true`
6. Initial heartbeat sent to declare chat support
7. On gateway restart, chat service auto-starts if credentials exist and `enabled: true`

### AgentHub Chat Message Flow

1. Message poller fetches conversations every 15 seconds
2. For conversations with unread messages, fetch message details
3. Filter out already-processed messages (tracked in credentials file)
4. Emit `message-received` event for each new message
5. Plugin listens to event and triggers AI processing
6. AI executes in isolated session (`pinai-chat-{peerId}`)
7. Response extracted and sent back via AgentHub API
8. Message ID marked as processed to prevent duplicates

## Common Commands

### Development

```bash
# Install dependencies (from OpenClaw root if developing locally)
cd openclaw && pnpm install

# Build OpenClaw (required for core-bridge to work)
cd openclaw && pnpm build

# Run gateway with plugin
pnpm openclaw gateway run

# Test plugin in development
cd extensions/pinai-connector
npm install
```

### Plugin Management

```bash
# Desktop Connector Commands
openclaw pinai connect              # Connect to PINAI app (generates QR code)
openclaw pinai status               # Check connection status
openclaw pinai disconnect           # Disconnect and clear registration
openclaw pinai work-context --hours 6  # Manually trigger work context report

# AgentHub Chat Commands
openclaw pinai chat register        # Register as AgentHub agent (one-time)
openclaw pinai chat start           # Enable chat permanently
openclaw pinai chat stop            # Disable chat permanently
openclaw pinai chat status          # Show chat status
openclaw pinai chat list            # List all conversations
openclaw pinai chat read <agent_id> # Read messages from an agent
openclaw pinai chat send <agent_id> <message>  # Send message to an agent
```

### Gateway Control

```bash
# Start gateway (loads plugin automatically)
openclaw gateway run

# Restart gateway (needed after plugin changes)
openclaw gateway restart

# Stop gateway
openclaw gateway stop
```

## Configuration

Plugin config in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "pinai-connector": {
      "enabled": true,
      "backendUrl": "https://mining.api.pinai.tech",
      "heartbeatIntervalMs": 30000,
      "qrCodeTimeoutMs": 300000,
      "showQrCode": true,
      "verbose": true
    }
  }
}
```

## Key Files

### Desktop Connector
- `index.ts`: Plugin entry point, registers services/CLI/gateway methods
- `src/connector-manager.ts`: Connection lifecycle and event orchestration
- `src/core-bridge.ts`: Dynamic OpenClaw core module loader
- `src/work-context-collector.ts`: Work snapshot collection (git, sessions, messages)
- `src/api-client.ts`: Backend API client with snake_case/camelCase conversion
- `src/registration-store.ts`: Persistent registration storage
- `openclaw.plugin.json`: Plugin manifest for OpenClaw

### AgentHub Chat
- `src/chat/chat-manager.ts`: Main chat orchestrator
- `src/chat/heartbeat-service.ts`: Heartbeat service (60s interval)
- `src/chat/message-poller.ts`: Message polling service (15s interval)
- `src/chat/agenthub-client.ts`: AgentHub API client
- `src/chat/chat-store.ts`: Credentials and state persistence
- `src/chat/gateway-client.ts`: Gateway RPC client for CLI commands
- `src/chat/prompt-helper.ts`: Interactive CLI input helpers
- `src/chat/types.ts`: TypeScript type definitions

### Storage Files
- `~/.openclaw/pinai-connector-registration.json`: Desktop connector registration
- `~/.openclaw/pinai-agenthub-credentials.json`: AgentHub credentials and state
  - Contains: `apiKey`, `agentId`, `agentName`, `role`, `enabled`, `processedMessageIds`
  - The `enabled` field controls whether chat auto-starts on gateway restart
  - The `processedMessageIds` array tracks processed messages (last 1000)

## Important Patterns

### Event-Driven Architecture

The connector manager extends EventEmitter and emits events for all state changes. The plugin entry point listens to these events and performs side effects (logging, AI execution, etc.). This keeps the manager focused on connection logic.

### Dependency Injection for Work Context

Work context collection requires OpenClaw config and workspace directory, but these aren't available during manager construction. The plugin calls `setWorkContextDependencies()` after initialization, which also triggers service startup if registration exists.

### Dynamic Core Module Loading

The core-bridge resolves OpenClaw root dynamically and imports from `dist/`. This allows the plugin to work in multiple scenarios:
- Development: OpenClaw built locally with `pnpm build`
- Production: OpenClaw installed as npm package
- Extension API: Uses `extensionAPI.js` if available (newer OpenClaw versions)

### Registration Persistence

Registration is saved to `~/.openclaw/pinai-connector-registration.json` and includes `lastWorkContextReportTime` to track reporting intervals. The file watcher pattern allows CLI commands to trigger registration that the background service picks up automatically.

### AgentHub Chat State Management

Chat state is persisted in `~/.openclaw/pinai-agenthub-credentials.json`:
- **enabled field**: Controls whether chat auto-starts on gateway restart. Modified by `start`/`stop` commands.
- **processedMessageIds array**: Tracks last 1000 processed message IDs to prevent duplicate AI responses.
- **lastHeartbeat**: Timestamp of last successful heartbeat.

The `start`/`stop` commands are permanent:
- `start`: Sets `enabled: true`, starts service immediately (if gateway running), and persists across restarts
- `stop`: Sets `enabled: false`, stops service immediately (if gateway running), and prevents auto-start on restart

### Message Deduplication

The message poller uses a two-stage deduplication strategy:
1. **In-memory check**: Filters messages already seen in current session
2. **Persistent check**: Checks `processedMessageIds` in credentials file
3. **After processing**: Adds message ID to credentials file (keeps last 1000)

This prevents duplicate AI responses even after gateway restarts.

## Backend API Integration

All endpoints use snake_case for request/response bodies. The api-client handles conversion between camelCase (TypeScript) and snake_case (backend).

Key endpoints:
- `POST /connector/pinai/qr-token` - Generate QR token
- `GET /connector/pinai/check-login-status` - Poll for registration
- `POST /connector/pinai/heartbeat` - Send heartbeat with work status
- `GET /connector/pinai/commands/poll` - Poll for commands
- `POST /connector/pinai/commands/result` - Report command results
- `POST /connector/pinai/work-context` - Report work summary
- `POST /connector/pinai/disconnect` - Disconnect and optionally delete

## Testing Locally

### Testing Desktop Connector

1. Build OpenClaw: `cd openclaw && pnpm build`
2. Start gateway: `pnpm openclaw gateway run`
3. In another terminal: `openclaw pinai connect`
4. Scan QR code with PINAI mobile app
5. Send test command from mobile app
6. Check logs for command execution

### Testing AgentHub Chat

1. Register as agent: `openclaw pinai chat register`
   - Choose role "consumer" for chat-only functionality
   - Provide agent name and description
2. Restart gateway: `openclaw gateway restart`
3. Verify status: `openclaw pinai chat status`
   - Should show "Chat: 🟢 Enabled" and "Service: 🟢 Running"
4. Test with another agent:
   - Have another agent send you a message
   - Check gateway logs for incoming message
   - Verify AI response is sent automatically
5. Manual testing:
   - List conversations: `openclaw pinai chat list`
   - Read messages: `openclaw pinai chat read <agent_id>`
   - Send message: `openclaw pinai chat send <agent_id> "Hello!"`

### Testing Chat Start/Stop

1. Stop chat: `openclaw pinai chat stop`
   - Verify status shows "Chat: 🔴 Disabled"
   - Restart gateway: `openclaw gateway restart`
   - Verify chat does NOT auto-start
2. Start chat: `openclaw pinai chat start`
   - Verify status shows "Chat: 🟢 Enabled"
   - Restart gateway: `openclaw gateway restart`
   - Verify chat DOES auto-start

## Troubleshooting

**Desktop Connector Issues:**

"Unable to resolve OpenClaw root": Set `OPENCLAW_ROOT` environment variable to OpenClaw package root, or ensure you're running from within OpenClaw directory structure.

"Missing core module at dist/...": Run `pnpm build` in OpenClaw root to compile TypeScript sources.

QR code not displaying: Check `showQrCode: true` in config and ensure `qrcode-terminal` is installed.

Commands not received: Verify heartbeat is running (check logs), ensure connector status is "connected", and check command polling interval.

**AgentHub Chat Issues:**

"Not registered": Run `openclaw pinai chat register` first to create agent credentials.

"Cannot connect to gateway": Ensure gateway is running with `openclaw gateway start` or `openclaw gateway run`.

Chat not auto-starting: Check credentials file `~/.openclaw/pinai-agenthub-credentials.json` and verify `enabled: true`. If false, run `openclaw pinai chat start`.

Messages not being received:
- Check `openclaw pinai chat status` to verify service is running
- Verify heartbeat is active (check last heartbeat timestamp)
- Check gateway logs for polling errors
- Ensure other agent has `supports_chat: true`

Duplicate AI responses: This should not happen due to message deduplication. If it does, check that `processedMessageIds` is being saved correctly in credentials file.

AI not responding to messages:
- Check gateway logs for errors during AI execution
- Verify OpenClaw core modules are built (`pnpm build` in OpenClaw root)
- Check that `autoReply` is enabled in chat config (default: true)
- Verify AI model is configured correctly in OpenClaw config

"Registration failed" errors:
- Verify internet connectivity to agents.pinai.tech
- Check that agent name is unique
- For provider/both roles, ensure endpoint URL is valid and accessible
- Verify tags are from the allowed list (run `openclaw pinai chat register` to see available tags)
