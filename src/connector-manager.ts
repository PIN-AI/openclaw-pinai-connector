/**
 * Desktop Connector Manager
 * Manages connection lifecycle, heartbeat, and communication with PINAI backend
 */

import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import { WebSocket } from "ws";
import type {
  CommandPayload,
  CommandResponse,
  ConnectorRegistration,
  DesktopConnectorConfig,
  DesktopConnectorStatus,
  HeartbeatPayload,
  QRCodeLoginToken,
} from "./types.js";
import { getDeviceId } from "./device-id.js";
import { isTokenValid } from "./qr-generator.js";
import {
  clearRegistration,
  loadRegistration,
  REGISTRATION_FILE,
  saveRegistration,
} from "./registration-store.js";
import { collectWorkContext, type WorkContextSummary, type WorkContextDependencies } from "./work-context-collector.js";

export class DesktopConnectorManager extends EventEmitter {
  private config: DesktopConnectorConfig;
  private currentToken: QRCodeLoginToken | null = null;
  private registration: ConnectorRegistration | null = null;
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private commandPollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private status: DesktopConnectorStatus = "disconnected";
  private lastWorkContext: WorkContextSummary | null = null;
  private lastWorkContextReportTime: number = 0;
  private isCollectingWorkContext: boolean = false;
  private workContextDeps: WorkContextDependencies | null = null;
  private registrationWatcher: FSWatcher | null = null;

  constructor(config: DesktopConnectorConfig) {
    super();
    this.config = config;

    // Try to load saved registration
    const savedRegistration = loadRegistration();
    if (savedRegistration) {
      this.registration = savedRegistration;
      this.status = "connected";

      // Restore last report time from saved registration
      this.lastWorkContextReportTime = savedRegistration.lastWorkContextReportTime || 0;

      // Don't start services yet - wait for dependencies to be set
      console.log(`\n✅ Restored connection from saved registration`);
      console.log(`Connector ID: ${savedRegistration.connectorId}`);
      console.log(`Device: ${savedRegistration.deviceName}\n`);

      this.emit("registered", this.registration);
    } else {
      this.startRegistrationWatcher();
    }
  }

  /**
   * Set work context dependencies for local snapshot collection
   * If registration exists, start heartbeat and polling
   */
  setWorkContextDependencies(deps: WorkContextDependencies): void {
    this.workContextDeps = deps;

    // If we have a saved registration, start services now
    if (this.registration && this.status === "connected") {
      this.startHeartbeat();
      this.startCommandPolling();
      console.log("[PINAI Connector] Services started with saved registration");
    }
  }

  private startRegistrationWatcher(): void {
    if (this.registrationWatcher || this.registration) {
      return;
    }

    const registrationDir = dirname(REGISTRATION_FILE);
    if (!existsSync(registrationDir)) {
      mkdirSync(registrationDir, { recursive: true });
    }

    this.registrationWatcher = watch(registrationDir, { persistent: false }, (_event, filename) => {
      if (filename && filename !== basename(REGISTRATION_FILE)) {
        return;
      }

      const savedRegistration = loadRegistration();
      if (!savedRegistration) {
        return;
      }

      if (this.registration && this.registration.connectorId === savedRegistration.connectorId) {
        return;
      }

      this.registration = savedRegistration;
      this.status = "connected";
      this.lastWorkContextReportTime = savedRegistration.lastWorkContextReportTime || 0;

      if (this.workContextDeps) {
        this.startHeartbeat();
        this.startCommandPolling();
        console.log("[PINAI Connector] Services started after registration update");
      }

      this.emit("registered", this.registration);
      this.stopRegistrationWatcher();
    });
  }

  private stopRegistrationWatcher(): void {
    if (!this.registrationWatcher) {
      return;
    }

    this.registrationWatcher.close();
    this.registrationWatcher = null;
  }

  /**
   * Generate a new QR code for login
   * Fetches token from backend so that mobile app registration can succeed
   */
  async generateQRCode(
    deviceName: string,
  ): Promise<{ qrData: string; token: string; deviceId?: string }> {
    // Get device ID first
    const deviceId = getDeviceId();

    const url = `${this.config.backendUrl}/connector/pinai/qr-token`;
    const requestBody = {
      device_name: deviceName,
      device_type: "desktop",
      device_id: deviceId,
    };

    console.log("\n=== Creating QR Token (Desktop) ===");
    console.log(`Request URL: ${url}`);
    console.log(`Request Body:`, JSON.stringify(requestBody, null, 2));

    // Get token from backend (required: backend must have this token for register to succeed)
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    console.log(`Response Status: ${res.status} ${res.statusText}`);

    if (!res.ok) {
      const text = await res.text();
      console.error(`Response Body (Error): ${text}`);
      throw new Error(`Failed to create QR token: ${res.status} ${text}`);
    }

    const data = (await res.json()) as {
      token: string;
      qr_data: string;
      expires_in: number;
    };

    console.log(`Response Body (Success):`);
    console.log(`  Token: ${data.token.substring(0, 20)}... (length: ${data.token.length})`);
    console.log(`  Full Token: ${data.token}`);
    console.log(`  Expires in: ${data.expires_in} seconds`);
    console.log(`  QR Data: ${data.qr_data}`);

    const now = Date.now();
    this.currentToken = {
      token: data.token,
      createdAt: now,
      expiresAt: now + data.expires_in * 1000,
    };

    // Append deviceId to QR data so app can send it when registering
    const qrData = data.qr_data.includes("?")
      ? `${data.qr_data}&deviceId=${encodeURIComponent(deviceId)}`
      : `${data.qr_data}?deviceId=${encodeURIComponent(deviceId)}`;

    // Start token expiration timer
    setTimeout(
      () => {
        if (this.currentToken && !this.registration) {
          this.emit("token-expired", this.currentToken);
          this.currentToken = null;
        }
      },
      Math.min(this.config.qrCodeTimeoutMs, data.expires_in * 1000),
    );

    this.emit("qr-generated", { qrData, token: this.currentToken.token, deviceId });

    // Start polling for registration
    this.startRegistrationPolling(this.currentToken.token, deviceName);

    return { qrData, token: this.currentToken.token, deviceId };
  }

  /**
   * Poll backend to check if QR token has been registered
   */
  private async startRegistrationPolling(token: string, _deviceName: string): Promise<void> {
    const maxAttempts = 60; // 5 minutes (60 * 5 seconds)
    let attempts = 0;

    console.log("\nWaiting for app to scan...\n");

    const pollInterval = setInterval(async () => {
      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        console.log("\n⚠️  QR code expired. Please restart to generate a new one.\n");
        this.emit("token-expired", this.currentToken);
        this.currentToken = null;
        return;
      }

      try {
        const response = await fetch(
          `${this.config.backendUrl}/connector/pinai/check-login-status?token=${token}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
          },
        );

        if (!response.ok) {
          throw new Error(`Status check failed: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.registered) {
          clearInterval(pollInterval);
          console.log("\n✅ Successfully connected to PINAI App!");
          console.log(`Connector ID: ${data.connector_id}`);
          console.log(`Device: ${data.device_name}\n`);

          // Save registration info
          this.registration = {
            connectorId: data.connector_id,
            deviceName: data.device_name,
            deviceType: "desktop",
            token: token,
            userId: "", // Will be populated from backend
            status: "connected",
            registeredAt: Date.now(),
          };

          // Persist registration to local file
          saveRegistration(this.registration);

          this.status = "connected";
          this.currentToken = null;

          // Start heartbeat and command polling
          this.startHeartbeat();
          this.startCommandPolling();

          this.emit("registered", this.registration);
          return;
        }

        if (data.expired) {
          clearInterval(pollInterval);
          console.log("\n⚠️  QR code expired. Please restart to generate a new one.\n");
          this.emit("token-expired", this.currentToken);
          this.currentToken = null;
          return;
        }

        // Still waiting for scan
        attempts++;
      } catch (error) {
        console.error("Error checking registration status:", error);
        attempts++;
      }
    }, 5000); // Poll every 5 seconds
  }

  /**
   * Register the connector with the backend after QR scan
   */
  async register(userId: string, deviceName: string): Promise<void> {
    if (!this.currentToken || !isTokenValid(this.currentToken)) {
      throw new Error("No valid token available");
    }

    try {
      // Call backend API to register connector
      const response = await fetch(`${this.config.backendUrl}/connector/pinai/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: this.currentToken.token,
          userId,
          deviceName,
          deviceType: "desktop",
        }),
      });

      if (!response.ok) {
        throw new Error(`Registration failed: ${response.statusText}`);
      }

      const data = await response.json();
      console.log("Registration data:", data);
      this.registration = {
        connectorId: data.connectorId,
        deviceName,
        deviceType: "desktop",
        token: this.currentToken.token,
        userId,
        status: "connected",
        registeredAt: Date.now(),
      };

      // Persist registration to local file
      saveRegistration(this.registration);

      this.status = "connected";
      this.currentToken = null; // Clear token after successful registration

      // Start WebSocket connection (optional, for future AppSync integration)
      // await this.connectWebSocket();

      // Start heartbeat
      this.startHeartbeat();

      // Start command polling
      this.startCommandPolling();

      this.emit("registered", this.registration);
    } catch (error) {
      this.status = "error";
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Connect to backend WebSocket for real-time communication
   */
  private async connectWebSocket(): Promise<void> {
    if (!this.registration) {
      throw new Error("Not registered");
    }

    const wsUrl = this.config.backendUrl.replace(/^http/, "ws");
    this.ws = new WebSocket(`${wsUrl}/ws/connector/${this.registration.connectorId}`);

    this.ws.on("open", () => {
      this.emit("ws-connected");
    });

    this.ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleWebSocketMessage(message);
      } catch (error) {
        this.emit("error", new Error(`Failed to parse WebSocket message: ${String(error)}`));
      }
    });

    this.ws.on("close", () => {
      this.emit("ws-disconnected");
      this.scheduleReconnect();
    });

    this.ws.on("error", (error) => {
      this.emit("error", error);
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(message: unknown): void {
    if (typeof message !== "object" || message === null) {
      return;
    }

    const msg = message as Record<string, unknown>;

    switch (msg.type) {
      case "command":
        this.handleCommand(msg as CommandPayload);
        break;
      case "ping":
        this.sendWebSocketMessage({ type: "pong" });
        break;
      default:
        this.emit("message", message);
    }
  }

  /**
   * Handle commands from backend
   */
  private async handleCommand(command: CommandPayload): Promise<void> {
    this.emit("command", command);

    // Commands will be handled by the gateway
    // For now, just acknowledge receipt
    const response: CommandResponse = {
      commandId: command.commandId,
      success: true,
      result: { received: true },
    };

    this.sendWebSocketMessage({
      type: "command-response",
      ...response,
    });
  }

  /**
   * Send heartbeat to backend
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatIntervalMs);

    // Send initial heartbeat
    this.sendHeartbeat();
  }

  /**
   * Send heartbeat payload
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.registration) {
      return;
    }

    // Check if we need to collect and report work context (daily)
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const timeSinceLastReport = now - this.lastWorkContextReportTime;

    // Only trigger if: enough time passed AND not already collecting
    if (timeSinceLastReport >= ONE_DAY_MS && !this.isCollectingWorkContext) {
      // Collect work context in the background (don't block heartbeat)
      this.collectAndReportWorkContext().catch((error) => {
        console.error(`[Work Context] Failed to collect: ${error}`);
      });
    }

    const payload: HeartbeatPayload = {
      connectorId: this.registration.connectorId,
      status: this.status === "connected" ? "online" : "offline",
      timestamp: Date.now(),
      workStatus: {
        lastActivity: Date.now(),
      },
    };

    // Convert to snake_case for backend API
    const backendPayload = {
      connector_id: payload.connectorId,
      status: payload.status,
      timestamp: payload.timestamp,
      work_status: payload.workStatus
        ? {
            last_activity: payload.workStatus.lastActivity,
          }
        : undefined,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(`${this.config.backendUrl}/connector/pinai/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.registration.token}`,
        },
        body: JSON.stringify(backendPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Heartbeat failed with status: ${response.status}`);
      }

      this.emit("heartbeat-sent", payload);
    } catch (error) {
      const errorDetails = error instanceof Error
        ? `${error.message} | Cause: ${error.cause ? String(error.cause) : 'unknown'}`
        : String(error);
      console.error(`[Heartbeat] Failed: ${errorDetails}`);
      this.emit("error", new Error(`Heartbeat failed: ${errorDetails}`));
    }
  }

  /**
   * Send message via WebSocket
   */
  private sendWebSocketMessage(message: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Start command polling (HTTP-based)
   */
  private startCommandPolling(): void {
    if (this.commandPollTimer) {
      clearInterval(this.commandPollTimer);
    }

    // Poll every 5 seconds
    this.commandPollTimer = setInterval(() => {
      this.pollCommands();
    }, 5000);

    // Poll immediately
    this.pollCommands();
  }

  /**
   * Poll for pending commands from backend
   */
  private async pollCommands(): Promise<void> {
    if (!this.registration) {
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(
        `${this.config.backendUrl}/connector/pinai/commands/poll?connector_id=${this.registration.connectorId}&limit=10`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to poll commands: ${response.status} ${response.statusText}`);
      }

      const commands = await response.json();

      // Execute each command
      for (const command of commands) {
        this.executeCommand(command);
      }
    } catch (error) {
      const errorDetails = error instanceof Error
        ? `${error.message} | Cause: ${error.cause ? String(error.cause) : 'unknown'}`
        : String(error);
      console.error(`[Command Polling] Failed: ${errorDetails}`);
      this.emit("error", new Error(`Command polling failed: ${errorDetails}`));
    }
  }

  /**
   * Execute a command received from backend
   */
  private async executeCommand(command: {
    command_id: string;
    command_type: string;
    command_payload: { prompt: string };
    priority: number;
    created_at: string;
  }): Promise<void> {
    this.emit("command-received", command);

    try {
      // For ai_prompt type, emit the prompt to be handled by the gateway
      if (command.command_type === "ai_prompt") {
        const prompt = command.command_payload.prompt;

        this.emit("ai-prompt", {
          commandId: command.command_id,
          prompt: prompt,
        });

        // The gateway will handle the prompt and call reportCommandResult
        // when it has a response
      } else {
        // Unknown command type
        await this.reportCommandResult(
          command.command_id,
          "failed",
          null,
          `Unknown command type: ${command.command_type}`,
        );
      }
    } catch (error) {
      await this.reportCommandResult(command.command_id, "failed", null, String(error));
    }
  }

  /**
   * Report command execution result to backend
   */
  async reportCommandResult(
    commandId: string,
    status: "completed" | "failed",
    result: unknown = null,
    errorMessage: string | null = null,
  ): Promise<void> {
    if (!this.registration) {
      return;
    }

    try {
      await fetch(`${this.config.backendUrl}/connector/pinai/commands/result`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command_id: commandId,
          connector_id: this.registration.connectorId,
          status: status,
          result: result,
          error_message: errorMessage,
        }),
      });

      this.emit("command-result-reported", { commandId, status });
    } catch (error) {
      this.emit("error", new Error(`Failed to report command result: ${String(error)}`));
    }
  }

  /**
   * Collect and report work context to backend
   */
  private async collectAndReportWorkContext(): Promise<void> {
    if (!this.registration) {
      return;
    }

    // Set flag to prevent concurrent collection
    if (this.isCollectingWorkContext) {
      console.log("[Work Context] Already collecting, skipping...");
      return;
    }

    this.isCollectingWorkContext = true;

    try {
      console.log("\n[Work Context] Starting collection...");

      // Collect full work context snapshot
      const workContext = await collectWorkContext(
        0,
        this.workContextDeps || undefined,
        this.lastWorkContextReportTime || undefined,
      );
      this.lastWorkContext = workContext;

      console.log(`[Work Context] Collected: ${workContext.context.substring(0, 100)}...`);

      if (!workContext.context || workContext.context.trim().length < 5) {
        console.log("[Work Context] Empty context, skipping backend report");
        return;
      }

      // Report to backend (raw context, backend handles AI summary)
      await fetch(`${this.config.backendUrl}/connector/pinai/work-context`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          connector_id: this.registration.connectorId,
          context: workContext.context,
          reported_at: Date.now(),
        }),
      });

      const reportTimestamp = Date.now();
      this.lastWorkContextReportTime = reportTimestamp;
      if (this.registration) {
        this.registration.lastWorkContextReportTime = reportTimestamp;
        saveRegistration(this.registration);
      }

      console.log("[Work Context] Successfully reported to backend");
      this.emit("work-context-reported", workContext);
    } catch (error) {
      console.error(`[Work Context] Failed to collect or report: ${error}`);
      this.emit("error", new Error(`Work context reporting failed: ${String(error)}`));
    } finally {
      // Always clear the flag, even if there was an error
      this.isCollectingWorkContext = false;
    }
  }

  /**
   * Schedule WebSocket reconnection
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.registration) {
        this.connectWebSocket().catch((error) => {
          this.emit("error", error);
        });
      }
    }, 5000); // Reconnect after 5 seconds
  }

  /**
   * Get current status
   */
  getStatus(): {
    status: DesktopConnectorStatus;
    registration: ConnectorRegistration | null;
    hasActiveToken: boolean;
  } {
    return {
      status: this.status,
      registration: this.registration,
      hasActiveToken: this.currentToken !== null && isTokenValid(this.currentToken),
    };
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(
    options: {
      clearRegistration?: boolean;
      watchForRegistration?: boolean;
      deleteRemote?: boolean;
    } = {},
  ): Promise<void> {
    this.stopRegistrationWatcher();

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.commandPollTimer) {
      clearInterval(this.commandPollTimer);
      this.commandPollTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    let remoteOk = false;
    if (this.registration) {
      // Notify backend of disconnection
      try {
        const response = await fetch(`${this.config.backendUrl}/connector/pinai/disconnect`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.registration.token}`,
          },
          body: JSON.stringify({
            connector_id: this.registration.connectorId,
            delete: options.deleteRemote === true,
          }),
        });
        remoteOk = response.ok;
        if (!response.ok) {
          console.error(
            `[PINAI Connector] Failed to disconnect: ${response.status} ${response.statusText}`,
          );
        }
      } catch {
        // Ignore errors during disconnect
      }

      const shouldClear = options.clearRegistration !== false;
      const needsRemoteSuccess = options.deleteRemote === true;
      if (shouldClear && (!needsRemoteSuccess || remoteOk)) {
        clearRegistration();
      }
    }

    this.registration = null;
    this.status = "disconnected";
    this.emit("disconnected");

    const shouldWatch =
      typeof options.watchForRegistration === "boolean"
        ? options.watchForRegistration
        : options.clearRegistration !== false;

    if (shouldWatch) {
      this.startRegistrationWatcher();
    }
  }
}
