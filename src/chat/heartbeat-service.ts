/**
 * Heartbeat Service
 * Sends periodic heartbeats to AgentHub to maintain online status
 */

import { EventEmitter } from "node:events";
import type { AgentHubClient } from "./agenthub-client.js";
import type { ChatConfig } from "./types.js";
import { updateLastHeartbeat } from "./chat-store.js";

export class HeartbeatService extends EventEmitter {
  private config: ChatConfig;
  private client: AgentHubClient;
  private timer: NodeJS.Timeout | null = null;
  private lastHeartbeatTime: number = 0;
  private isRunning: boolean = false;

  constructor(config: ChatConfig, client: AgentHubClient) {
    super();
    this.config = config;
    this.client = client;
  }

  /**
   * Start the heartbeat service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Heartbeat service is already running");
    }

    // Send initial heartbeat
    await this.sendHeartbeat();

    // Start periodic heartbeat
    this.timer = setInterval(() => {
      this.sendHeartbeat().catch((error) => {
        console.error(`[Heartbeat] Failed to send heartbeat: ${error.message}`);
        this.emit("error", error);
      });
    }, this.config.heartbeatIntervalMs);

    this.isRunning = true;
    this.emit("started");
  }

  /**
   * Stop the heartbeat service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Send final offline heartbeat
    try {
      await this.client.sendHeartbeat(false, { status: "offline" });
    } catch (error) {
      console.error(`[Heartbeat] Failed to send offline heartbeat: ${error}`);
    }

    this.isRunning = false;
    this.emit("stopped");
  }

  /**
   * Send a heartbeat
   */
  private async sendHeartbeat(): Promise<void> {
    try {
      const response = await this.client.sendHeartbeat(true);
      this.lastHeartbeatTime = Date.now();

      // Update stored timestamp
      updateLastHeartbeat(this.lastHeartbeatTime);

      this.emit("heartbeat-sent", {
        timestamp: this.lastHeartbeatTime,
        unreadCount: response.unread_count || 0,
      });

      // Emit unread count if there are new messages
      if (response.unread_count && response.unread_count > 0) {
        this.emit("unread-messages", response.unread_count);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get the last heartbeat timestamp
   */
  getLastHeartbeatTime(): number {
    return this.lastHeartbeatTime;
  }

  /**
   * Check if the service is running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }
}
