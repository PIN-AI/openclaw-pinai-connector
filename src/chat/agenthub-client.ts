/**
 * AgentHub API Client
 */

import type {
  HeartbeatResponse,
  HealthResponse,
  Conversation,
  Message,
  SendMessageResponse,
  RegistrationPayload,
  RegistrationResponse,
} from "./types.js";

const AGENTHUB_BASE_URL = "https://agents.pinai.tech";

export class AgentHubClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Send heartbeat to AgentHub
   */
  async sendHeartbeat(
    supportsChat: boolean = true,
    options?: { status?: "online" | "offline" }
  ): Promise<HeartbeatResponse> {
    const response = await fetch(`${AGENTHUB_BASE_URL}/api/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        supports_chat: supportsChat,
        ...(options?.status && { status: options.status }),
      }),
    });

    if (!response.ok) {
      throw new Error(`Heartbeat failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get agent health status
   */
  async getHealth(agentId: string): Promise<HealthResponse> {
    const response = await fetch(`${AGENTHUB_BASE_URL}/api/agents/${agentId}/health`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get all conversations
   */
  async getConversations(): Promise<Conversation[]> {
    const response = await fetch(`${AGENTHUB_BASE_URL}/api/messages`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Get conversations failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.conversations || [];
  }

  /**
   * Get messages from a specific peer
   */
  async getMessages(peerId: string, limit: number = 50): Promise<Message[]> {
    const response = await fetch(
      `${AGENTHUB_BASE_URL}/api/messages/${peerId}?limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Get messages failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.messages || [];
  }

  /**
   * Send a message to an agent
   */
  async sendMessage(targetAgentId: string, content: string): Promise<SendMessageResponse> {
    const response = await fetch(`${AGENTHUB_BASE_URL}/api/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        target_agent_id: targetAgentId,
        content,
      }),
    });

    if (!response.ok) {
      throw new Error(`Send message failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Search for agents on AgentHub
   */
  async searchAgents(options?: {
    role?: string;
    tags?: string[];
    limit?: number;
  }): Promise<any[]> {
    const params = new URLSearchParams();
    if (options?.role) params.append("role", options.role);
    if (options?.tags) params.append("tags", options.tags.join(","));
    if (options?.limit) params.append("limit", options.limit.toString());

    const url = `${AGENTHUB_BASE_URL}/api/agents${params.toString() ? `?${params.toString()}` : ""}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Search agents failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.agents || [];
  }

  /**
   * Get available tags
   */
  static async getTags(): Promise<string[]> {
    const response = await fetch(`${AGENTHUB_BASE_URL}/api/tags`);

    if (!response.ok) {
      throw new Error(`Get tags failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.tags || [];
  }

  /**
   * Register a new agent
   */
  static async register(payload: RegistrationPayload): Promise<RegistrationResponse> {
    const response = await fetch(`${AGENTHUB_BASE_URL}/api/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Registration failed: ${response.status} ${errorText}`);
    }

    return await response.json();
  }
}
