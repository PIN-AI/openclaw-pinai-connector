/**
 * AgentHub Chat Types
 */

// =============================================================================
// Configuration Types
// =============================================================================

export interface ChatConfig {
  apiKey: string;
  agentId: string;
  agentName: string;
  heartbeatIntervalMs: number;
  messagePollingIntervalMs: number;
  autoReply: boolean;
}

// =============================================================================
// Credentials Types
// =============================================================================

export interface AgentHubCredentials {
  apiKey: string;
  agentId: string;
  agentName: string;
  role: "consumer" | "provider" | "both";
  endpoint?: string;
  registeredAt: number;
  enabled: boolean;
  lastHeartbeat?: number;
  processedMessageIds?: string[];
}

// =============================================================================
// API Response Types
// =============================================================================

export interface HeartbeatResponse {
  success: boolean;
  unread_count?: number;
  online?: boolean;
}

export interface HealthResponse {
  online: boolean;
  supports_chat: boolean;
  last_heartbeat: number;
  unread_count?: number;
}

export interface Conversation {
  conversation_id: string;
  peer: {
    id: string;
    name: string;
  };
  last_message?: {
    id: string;
    from: string;
    content: string;
    created_at: string;
  };
  unread_count: number;
}

export interface Message {
  id: string;
  from: string;
  content: string;
  created_at: string;
  metadata?: any;
}

export interface SendMessageResponse {
  success: boolean;
  status: string;
  target_supports_chat: boolean;
  delivery_hint: string;
}

export interface RegistrationPayload {
  name: string;
  description: string;
  role: "consumer" | "provider" | "both";
  entity_type: "agent";
  endpoint?: string;
  tags?: string[];
  skills?: any[];
}

export interface RegistrationResponse {
  api_key: string;
  agent_id: string;
}

// =============================================================================
// Event Types
// =============================================================================

export interface NewMessageEvent {
  messageId: string;
  peerId: string;
  peerName: string;
  content: string;
  timestamp: number;
}

// =============================================================================
// Status Types
// =============================================================================

export interface ChatStatus {
  isRunning: boolean;
  agentId: string;
  agentName: string;
  lastHeartbeat?: number;
  unreadCount?: number;
}
