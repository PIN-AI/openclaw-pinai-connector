/**
 * AgentHub Chat Manager
 * Orchestrates heartbeat and message polling services
 */

import { EventEmitter } from "node:events";
import { AgentHubClient } from "./agenthub-client.js";
import { HeartbeatService } from "./heartbeat-service.js";
import { MessagePoller } from "./message-poller.js";
import type { ChatConfig, ChatStatus, NewMessageEvent } from "./types.js";

export class AgentHubChatManager extends EventEmitter {
  private config: ChatConfig;
  private client: AgentHubClient;
  private heartbeatService: HeartbeatService;
  private messagePoller: MessagePoller;
  private isRunning: boolean = false;

  constructor(config: ChatConfig) {
    super();
    this.config = config;
    this.client = new AgentHubClient(config.apiKey);
    this.heartbeatService = new HeartbeatService(config, this.client);
    this.messagePoller = new MessagePoller(config, this.client);

    // Forward events from services
    this.heartbeatService.on("heartbeat-sent", (data) => {
      this.emit("heartbeat-sent", data);
    });

    this.heartbeatService.on("unread-messages", (count) => {
      this.emit("unread-messages", count);
    });

    this.messagePoller.on("new-message", (message: NewMessageEvent) => {
      this.emit("message-received", message);
    });

    this.heartbeatService.on("error", (error) => {
      this.emit("error", error);
    });

    this.messagePoller.on("error", (error) => {
      this.emit("error", error);
    });
  }

  /**
   * Start the chat manager (heartbeat + message polling)
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Chat service is already running");
    }

    try {
      // Send initial online heartbeat
      await this.client.sendHeartbeat(true);

      // Start heartbeat service
      await this.heartbeatService.start();

      // Start message polling
      await this.messagePoller.start();

      this.isRunning = true;
      this.emit("started");
    } catch (error) {
      // Cleanup on failure
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Stop the chat manager
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      throw new Error("Chat service is not running");
    }

    await this.cleanup();
    this.isRunning = false;
    this.emit("stopped");
  }

  /**
   * Cleanup services
   */
  private async cleanup(): Promise<void> {
    try {
      // Stop message polling first
      await this.messagePoller.stop();

      // Stop heartbeat (sends offline heartbeat)
      await this.heartbeatService.stop();
    } catch (error) {
      console.error(`[Chat Manager] Cleanup error: ${error}`);
    }
  }

  /**
   * Send a message to another agent
   */
  async sendMessage(targetAgentId: string, content: string): Promise<void> {
    try {
      await this.client.sendMessage(targetAgentId, content);
    } catch (error) {
      throw new Error(`Failed to send message: ${error}`);
    }
  }

  /**
   * Get current status
   */
  getStatus(): ChatStatus {
    return {
      isRunning: this.isRunning,
      agentId: this.config.agentId,
      agentName: this.config.agentName,
      lastHeartbeat: this.heartbeatService.getLastHeartbeatTime(),
      unreadCount: this.messagePoller.getUnreadCount(),
    };
  }

  /**
   * Get the API client (for direct access if needed)
   */
  getClient(): AgentHubClient {
    return this.client;
  }
}
