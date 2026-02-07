/**
 * Desktop Connector Types
 *
 * Type definitions for the PINAI Desktop Connector.
 * Includes configuration, registration, heartbeat, and command types.
 */

import {
  DEFAULT_BACKEND_URL,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_QR_CODE_TIMEOUT_MS,
  DEVICE_TYPE,
} from "./constants.js";

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Connection status states
 */
export type DesktopConnectorStatus = "pending" | "connected" | "disconnected" | "error";

/**
 * Desktop Connector configuration options
 */
export interface DesktopConnectorConfig {
  /** Whether the connector is enabled */
  enabled: boolean;

  /** Backend API URL */
  backendUrl: string;

  /** Heartbeat interval in milliseconds */
  heartbeatIntervalMs: number;

  /** QR code expiration timeout in milliseconds */
  qrCodeTimeoutMs: number;
}

/**
 * Create default configuration with optional overrides
 */
export function createDefaultConfig(
  overrides?: Partial<DesktopConnectorConfig>,
): DesktopConnectorConfig {
  return {
    enabled: true,
    backendUrl: DEFAULT_BACKEND_URL,
    heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
    qrCodeTimeoutMs: DEFAULT_QR_CODE_TIMEOUT_MS,
    ...overrides,
  };
}

// =============================================================================
// QR Code & Token Types
// =============================================================================

/**
 * QR code login token data
 */
export interface QRCodeLoginToken {
  /** The unique token string */
  token: string;

  /** Token expiration timestamp (Unix ms) */
  expiresAt: number;

  /** Token creation timestamp (Unix ms) */
  createdAt: number;
}

/**
 * QR code generation result
 */
export interface QRCodeGenerationResult {
  /** Full QR data string (deep link) */
  qrData: string;

  /** Token string */
  token: string;

  /** Device identifier */
  deviceId?: string;
}

// =============================================================================
// Registration Types
// =============================================================================

/**
 * Device type - currently only desktop is supported
 */
export type DeviceType = typeof DEVICE_TYPE;

/**
 * Connector registration information
 */
export interface ConnectorRegistration {
  /** Unique connector identifier from backend */
  connectorId: string;

  /** Human-readable device name */
  deviceName: string;

  /** Device type (always 'desktop' for this connector) */
  deviceType: DeviceType;

  /** Authentication token */
  token: string;

  /** Associated user ID (optional) */
  userId?: string;

  /** Current connection status */
  status: DesktopConnectorStatus;

  /** Registration timestamp (Unix ms) */
  registeredAt?: number;

  /** Last work context report timestamp (Unix ms) */
  lastWorkContextReportTime?: number;
}

/**
 * Validate registration data has required fields
 */
export function isValidRegistration(data: unknown): data is ConnectorRegistration {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const reg = data as Record<string, unknown>;

  return (
    typeof reg.connectorId === "string" &&
    reg.connectorId.length > 0 &&
    typeof reg.token === "string" &&
    reg.token.length > 0 &&
    typeof reg.deviceName === "string" &&
    reg.deviceName.length > 0
  );
}

// =============================================================================
// Heartbeat Types
// =============================================================================

/**
 * Work context info included in heartbeat
 */
export interface WorkContextInfo {
  /** Summary of recent work activity */
  summary: string;

  /** Number of sessions in the period */
  sessionCount: number;

  /** Duration of the reporting period in hours */
  periodHours: number;
}

/**
 * Work status included in heartbeat
 */
export interface WorkStatus {
  /** Current project name (optional) */
  currentProject?: string;

  /** List of recently active files (optional) */
  activeFiles?: string[];

  /** Last activity timestamp (optional) */
  lastActivity?: number;

  /** Work context summary (optional) */
  workContext?: WorkContextInfo;
}

/**
 * Heartbeat payload sent to backend
 */
export interface HeartbeatPayload {
  /** Connector identifier */
  connectorId: string;

  /** Online/offline status */
  status: "online" | "offline";

  /** Timestamp of the heartbeat */
  timestamp: number;

  /** Work status information (optional) */
  workStatus?: WorkStatus;
}

// =============================================================================
// Command Types
// =============================================================================

/**
 * Command types supported by the connector
 */
export type CommandType = "execute" | "query" | "status";

/**
 * Command payload received from backend
 */
export interface CommandPayload {
  /** Unique command identifier */
  commandId: string;

  /** Type of command */
  type: CommandType;

  /** Command data */
  data: unknown;
}

/**
 * AI prompt command data
 */
export interface AIPromptCommand {
  /** Unique command identifier */
  commandId: string;

  /** The prompt text to process */
  prompt: string;
}

/**
 * Command execution response
 */
export interface CommandResponse {
  /** Command identifier being responded to */
  commandId: string;

  /** Whether the command succeeded */
  success: boolean;

  /** Result data (optional) */
  result?: unknown;

  /** Error message if failed (optional) */
  error?: string;
}

/**
 * Command execution status
 */
export type CommandStatus = "completed" | "failed";

// =============================================================================
// WebSocket Types
// =============================================================================

/**
 * WebSocket message types
 */
export type WebSocketMessageType = "command" | "ping" | "pong" | "command-response";

/**
 * Base WebSocket message
 */
export interface WebSocketMessage {
  type: WebSocketMessageType;
  [key: string]: unknown;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Events emitted by the connector manager
 */
export interface ConnectorEvents {
  "qr-generated": QRCodeGenerationResult;
  "token-expired": QRCodeLoginToken | null;
  registered: ConnectorRegistration;
  disconnected: void;
  "ws-connected": void;
  "ws-disconnected": void;
  "heartbeat-sent": HeartbeatPayload;
  "command-received": unknown;
  "command-result-reported": { commandId: string; status: CommandStatus };
  "ai-prompt": AIPromptCommand;
  "work-context-reported": unknown;
  message: unknown;
  command: CommandPayload;
  error: Error;
}

// =============================================================================
// Status Types
// =============================================================================

/**
 * Connector status information
 */
export interface ConnectorStatusInfo {
  /** Current connection status */
  status: DesktopConnectorStatus;

  /** Registration info if registered */
  registration: ConnectorRegistration | null;

  /** Whether there's an active (non-expired) token */
  hasActiveToken: boolean;
}
