# Changelog

All notable changes to the PINAI Connector for OpenClaw will be documented in this file.

## [1.0.0] - 2026-02-07

### Added
- Initial release of PINAI Connector plugin
- QR code authentication for desktop pairing
- Automatic heartbeat mechanism (30s interval)
- Command polling from PINAI backend (5s interval)
- AI prompt execution using OpenClaw's embedded agent
- Work context reporting (6 hour interval)
- Auto-reconnect on gateway restart
- Device ID generation from MAC address
- Persistent registration storage
- Comprehensive error handling and logging

### Features
- Secure WebSocket connection to PINAI backend
- QR code generation and display in terminal
- Session-based command tracking
- Configurable backend URL and intervals
- Detailed logging for debugging

### Documentation
- Installation guide
- Configuration examples
- Testing guide with 10 test scenarios
- Troubleshooting section
