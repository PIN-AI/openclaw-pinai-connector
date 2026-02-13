/**
 * Message Poller Service
 * Polls AgentHub for new messages at regular intervals
 */

import { EventEmitter } from "node:events";
import type { AgentHubClient } from "./agenthub-client.js";
import type { ChatConfig, NewMessageEvent } from "./types.js";
import { isMessageProcessed, addProcessedMessageId } from "./chat-store.js";

export class MessagePoller extends EventEmitter {
  private config: ChatConfig;
  private client: AgentHubClient;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private unreadCount: number = 0;

  constructor(config: ChatConfig, client: AgentHubClient) {
    super();
    this.config = config;
    this.client = client;
  }

  /**
   * Start the message polling service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Message poller is already running");
    }

    // Poll immediately
    await this.pollMessages();

    // Start periodic polling
    this.timer = setInterval(() => {
      this.pollMessages().catch((error) => {
        console.error(`[Message Poller] Failed to poll messages: ${error.message}`);
        this.emit("error", error);
      });
    }, this.config.messagePollingIntervalMs);

    this.isRunning = true;
    this.emit("started");
  }

  /**
   * Stop the message polling service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.isRunning = false;
    this.emit("stopped");
  }

  /**
   * Poll for new messages
   */
  private async pollMessages(): Promise<void> {
    try {
      // Get all conversations
      const conversations = await this.client.getConversations();

      // Update unread count
      this.unreadCount = conversations.reduce(
        (sum, conv) => sum + conv.unread_count,
        0
      );

      // Process conversations with unread messages
      for (const conv of conversations) {
        if (conv.unread_count > 0) {
          await this.processConversation(conv.peer.id, conv.peer.name);
        }
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Process a conversation and emit new messages
   */
  private async processConversation(
    peerId: string,
    peerName: string
  ): Promise<void> {
    try {
      // Fetch messages from this peer
      const messages = await this.client.getMessages(peerId, 50);

      // Filter out already processed messages
      const newMessages = messages.filter(
        (msg) => !isMessageProcessed(msg.id) && msg.from === peerId
      );

      // Emit new message events
      for (const msg of newMessages) {
        const event: NewMessageEvent = {
          messageId: msg.id,
          peerId: peerId,
          peerName: peerName,
          content: msg.content,
          timestamp: new Date(msg.created_at).getTime(),
        };

        this.emit("new-message", event);

        // Mark as processed
        addProcessedMessageId(msg.id);
      }
    } catch (error) {
      console.error(
        `[Message Poller] Failed to process conversation with ${peerId}: ${error}`
      );
    }
  }

  /**
   * Get current unread count
   */
  getUnreadCount(): number {
    return this.unreadCount;
  }

  /**
   * Check if the service is running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }
}
