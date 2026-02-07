# PINAI Connector Plugin - Testing Guide

This guide provides step-by-step instructions for testing the PINAI Connector plugin after refactoring.

## Prerequisites

- OpenClaw built successfully (`pnpm build`)
- PINAI backend running at `https://dev-mining.api.pinai.tech`
- PINAI mobile app installed and ready
- Branch: `feature/pinai-connector-plugin`

---

## Phase 4 Testing Checklist

### Test 1: Plugin Loading ✓

**Objective:** Verify plugin loads on gateway startup without errors.

**Steps:**
1. Start OpenClaw gateway:
   ```bash
   cd /Users/heyuehui/Desktop/PINAI/ClawdConnector/openclaw
   pnpm openclaw gateway run
   ```

2. Watch console output for plugin loading messages

**Expected Results:**
- ✅ No errors during startup
- ✅ Plugin service starts: `[PINAI Connector] Service started`
- ✅ QR code displays in console (if no saved registration)
- ✅ No TypeScript or module loading errors

**Troubleshooting:**
- If plugin doesn't load: Check `pnpm-workspace.yaml` includes `extensions/*`
- If module errors: Run `pnpm install` to ensure dependencies are installed
- If QR doesn't show: Check `showQrCode` config is `true`

---

### Test 2: QR Code Generation ✓

**Objective:** Verify QR code generation works correctly.

**Steps:**
1. With gateway running, observe console output
2. QR code should display automatically on first run
3. Note the device name and token details

**Expected Results:**
- ✅ QR code displays in terminal (ASCII art)
- ✅ Device name shown: `PINAI-Desktop-{hostname}`
- ✅ Token displayed (first 16 chars)
- ✅ Message: "Waiting for app to scan..."

**Manual Test (Optional):**
```bash
# Call gateway method directly (requires gateway running)
# This would require a gateway client or web interface
```

**Troubleshooting:**
- If no QR: Check `qrcode-terminal` dependency is installed
- If token error: Check backend connectivity
- If device name wrong: Verify `os.hostname()` works

---

### Test 3: Registration ✓

**Objective:** Verify mobile app can scan QR and register connector.

**Steps:**
1. Open PINAI mobile app
2. Navigate to "Connect Desktop" or similar feature
3. Scan the QR code displayed in terminal
4. Wait for registration confirmation

**Expected Results:**
- ✅ Mobile app successfully scans QR
- ✅ Console shows: `[PINAI Connector] Successfully connected to PINAI App!`
- ✅ Connector ID displayed
- ✅ Device name confirmed
- ✅ Status shows: `connected`
- ✅ Registration saved to `~/.openclaw/pinai-connector-registration.json`

**Verification:**
```bash
# Check saved registration
cat ~/.openclaw/pinai-connector-registration.json
```

**Troubleshooting:**
- If scan fails: Ensure QR is not expired (5 min timeout)
- If registration fails: Check backend logs
- If not saved: Check file permissions on `~/.openclaw/`

---

### Test 4: Auto-Reconnect ✓

**Objective:** Verify connector auto-reconnects on restart.

**Steps:**
1. Stop gateway (Ctrl+C)
2. Restart gateway: `pnpm openclaw gateway run`
3. Observe startup behavior

**Expected Results:**
- ✅ No QR code displayed (uses saved registration)
- ✅ Console shows: `[PINAI Connector] Using saved registration`
- ✅ Connector ID displayed
- ✅ Heartbeat starts automatically
- ✅ Status: `connected`

**Troubleshooting:**
- If QR shows again: Registration file may be missing or invalid
- If connection fails: Backend may have cleared the registration

---

### Test 5: Command Execution ✓

**Objective:** Verify desktop receives and executes commands from mobile.

**Steps:**
1. Ensure gateway is running and connected
2. In PINAI mobile app, send a command to desktop:
   - Example: "Find all TODO comments in the current project"
3. Watch console for command reception and execution

**Expected Results:**
- ✅ Console shows: `[PINAI Command] Received AI prompt`
- ✅ Command ID displayed
- ✅ Prompt text shown
- ✅ Console shows: `[PINAI Command] Executing with OpenClaw AI...`
- ✅ AI processes the prompt (may take 10-120 seconds)
- ✅ Console shows: `[PINAI Command] Execution completed successfully`
- ✅ Response length displayed
- ✅ Console shows: `[PINAI Command] Result reported to backend (status: completed)`
- ✅ Mobile app receives the result

**Verification in Mobile App:**
- Result should appear in chat
- Response should be relevant to the prompt
- No error messages

**Troubleshooting:**
- If no command received: Check command polling is running (every 5s)
- If execution fails: Check OpenClaw agent is configured correctly
- If result not reported: Check backend connectivity
- If mobile doesn't get result: Check backend API logs

---

### Test 6: Heartbeat ✓

**Objective:** Verify heartbeat sends every 30 seconds.

**Steps:**
1. With gateway running and connected, wait and observe
2. Watch for heartbeat messages in console (if verbose logging enabled)
3. Wait at least 2 minutes to see multiple heartbeats

**Expected Results:**
- ✅ Heartbeat sends every 30 seconds
- ✅ No errors during heartbeat
- ✅ Backend shows connector as "online"
- ✅ Last heartbeat timestamp updates

**Verification:**
```bash
# Check backend API (if accessible)
# GET /connector/pinai/status?connector_id={id}
```

**Troubleshooting:**
- If heartbeat stops: Check for network issues
- If errors: Check backend API is responding
- If too frequent/infrequent: Check `heartbeatIntervalMs` config

---

### Test 7: Work Context Reporting ✓

**Objective:** Verify work context reports every 6 hours (optional long-running test).

**Steps:**
1. Keep gateway running for 6+ hours
2. Observe work context collection and reporting

**Expected Results:**
- ✅ After 6 hours, console shows: `[Work Context] Asking OpenClaw AI to summarize...`
- ✅ AI generates work summary (200-300 words)
- ✅ Summary sent to backend
- ✅ No errors during collection

**Note:** This is a long-running test. Can be skipped for initial verification.

**Troubleshooting:**
- If doesn't trigger: Check `WORK_CONTEXT_REPORT_INTERVAL_MS` constant
- If AI fails: Check OpenClaw agent configuration
- If report fails: Check backend API

---

### Test 8: Configuration ✓

**Objective:** Verify plugin configuration works correctly.

**Steps:**
1. Stop gateway
2. Edit OpenClaw config (`~/.openclaw/openclaw.json`):
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
3. Restart gateway
4. Verify config is applied

**Expected Results:**
- ✅ Plugin reads config correctly
- ✅ Backend URL is used
- ✅ Heartbeat interval is respected
- ✅ QR timeout works as configured
- ✅ Verbose logging shows/hides based on setting

**Test Variations:**
- Set `enabled: false` → Plugin should not start
- Change `backendUrl` → Should connect to different backend
- Set `showQrCode: false` → QR should not display
- Set `verbose: false` → Less console output

**Troubleshooting:**
- If config ignored: Check JSON syntax is valid
- If plugin doesn't respect config: Check plugin entry point reads `api.pluginConfig`

---

### Test 9: Disconnect ✓

**Objective:** Verify clean disconnect functionality.

**Steps:**
1. With gateway running and connected
2. Call disconnect method (via gateway client or stop gateway)
3. Observe cleanup behavior

**Expected Results:**
- ✅ Heartbeat stops
- ✅ Command polling stops
- ✅ WebSocket closes (if applicable)
- ✅ Backend notified of disconnect
- ✅ Saved registration cleared (if full disconnect)
- ✅ Console shows: `[PINAI Connector] Service stopped`

**Troubleshooting:**
- If cleanup incomplete: Check service stop() method
- If backend not notified: Check disconnect API call

---

### Test 10: Error Handling ✓

**Objective:** Verify plugin handles errors gracefully.

**Test Scenarios:**

**A. Backend Unreachable:**
1. Stop backend or use invalid URL
2. Start gateway
3. Observe error handling

**Expected:**
- ✅ Plugin logs error but doesn't crash
- ✅ Retries connection (if implemented)
- ✅ Gateway continues running

**B. Invalid QR Token:**
1. Manually corrupt saved registration file
2. Restart gateway
3. Observe recovery

**Expected:**
- ✅ Plugin detects invalid registration
- ✅ Generates new QR code
- ✅ Allows re-registration

**C. Command Execution Failure:**
1. Send command that causes AI error
2. Observe error handling

**Expected:**
- ✅ Error caught and logged
- ✅ Failure reported to backend
- ✅ Plugin continues running
- ✅ Next command can still execute

---

## Test Results Summary

Use this checklist to track test completion:

- [ ] Test 1: Plugin Loading
- [ ] Test 2: QR Code Generation
- [ ] Test 3: Registration
- [ ] Test 4: Auto-Reconnect
- [ ] Test 5: Command Execution
- [ ] Test 6: Heartbeat
- [ ] Test 7: Work Context Reporting (optional)
- [ ] Test 8: Configuration
- [ ] Test 9: Disconnect
- [ ] Test 10: Error Handling

---

## Known Issues / Limitations

Document any issues found during testing:

1. **Issue:** [Description]
   - **Impact:** [High/Medium/Low]
   - **Workaround:** [If available]
   - **Fix Required:** [Yes/No]

---

## Performance Metrics

Track these metrics during testing:

- **Plugin Load Time:** ___ ms
- **QR Generation Time:** ___ ms
- **Registration Time:** ___ seconds
- **Command Execution Time:** ___ seconds (varies by prompt)
- **Heartbeat Reliability:** ___% (successful / total)
- **Memory Usage:** ___ MB (plugin service)

---

## Regression Testing

After any code changes, re-run these critical tests:

1. Plugin Loading (Test 1)
2. QR Code Generation (Test 2)
3. Command Execution (Test 5)
4. Configuration (Test 8)

---

## Automated Testing (Future)

Consider adding automated tests for:

- Plugin discovery and loading
- Configuration parsing
- QR code generation logic
- Command payload handling
- Error recovery scenarios

---

## Sign-Off

**Tester:** _______________
**Date:** _______________
**Branch:** feature/pinai-connector-plugin
**Commit:** 7418639a0
**Result:** [ ] PASS [ ] FAIL [ ] PARTIAL

**Notes:**
