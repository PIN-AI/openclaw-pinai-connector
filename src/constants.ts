/**
 * Desktop Connector Constants
 *
 * Centralized configuration constants for the PINAI Desktop Connector.
 * All magic numbers and repeated values should be defined here.
 */

// =============================================================================
// Timing Constants (in milliseconds)
// =============================================================================

/** Default heartbeat interval - how often to send heartbeat to backend */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

/** Default QR code expiration timeout */
export const DEFAULT_QR_CODE_TIMEOUT_MS = 300_000; // 5 minutes

/** Command polling interval - how often to check for new commands */
export const COMMAND_POLL_INTERVAL_MS = 5_000; // 5 seconds

/** WebSocket reconnection delay */
export const WEBSOCKET_RECONNECT_DELAY_MS = 5_000; // 5 seconds

/** Registration polling interval */
export const REGISTRATION_POLL_INTERVAL_MS = 5_000; // 5 seconds

/** Maximum registration polling attempts (5 minutes total with 5s interval) */
export const MAX_REGISTRATION_POLL_ATTEMPTS = 60;

/** Work context reporting interval */
export const WORK_CONTEXT_REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Work context collection timeout */
export const WORK_CONTEXT_TIMEOUT_MS = 60_000; // 60 seconds

// =============================================================================
// API Configuration
// =============================================================================

/** Default backend API URL */
export const DEFAULT_BACKEND_URL = "https://dev-mining.api.pinai.tech";

/** Device type identifier for desktop connectors */
export const DEVICE_TYPE = "desktop" as const;

/** Connector type prefix for device naming */
export const DEVICE_NAME_PREFIX = "PINAI-Desktop";

// =============================================================================
// API Endpoints
// =============================================================================

export const API_ENDPOINTS = {
  /** Generate QR token for login */
  QR_TOKEN: "/connector/pinai/qr-token",

  /** Check login/registration status */
  CHECK_LOGIN_STATUS: "/connector/pinai/check-login-status",

  /** Register new connector */
  REGISTER: "/connector/pinai/register",

  /** Send heartbeat */
  HEARTBEAT: "/connector/pinai/heartbeat",

  /** Poll for pending commands */
  COMMANDS_POLL: "/connector/pinai/commands/poll",

  /** Report command execution result */
  COMMANDS_RESULT: "/connector/pinai/commands/result",

  /** Report work context */
  WORK_CONTEXT: "/connector/pinai/work-context",

  /** Disconnect connector */
  DISCONNECT: "/connector/pinai/disconnect",
} as const;

// =============================================================================
// Command Types
// =============================================================================

export const COMMAND_TYPES = {
  /** AI prompt command - request AI to process a prompt */
  AI_PROMPT: "ai_prompt",
} as const;

// =============================================================================
// Event Names
// =============================================================================

export const CONNECTOR_EVENTS = {
  /** Emitted when QR code is generated */
  QR_GENERATED: "qr-generated",

  /** Emitted when token expires */
  TOKEN_EXPIRED: "token-expired",

  /** Emitted when registration is complete */
  REGISTERED: "registered",

  /** Emitted when connector disconnects */
  DISCONNECTED: "disconnected",

  /** Emitted when WebSocket connects */
  WS_CONNECTED: "ws-connected",

  /** Emitted when WebSocket disconnects */
  WS_DISCONNECTED: "ws-disconnected",

  /** Emitted when heartbeat is sent */
  HEARTBEAT_SENT: "heartbeat-sent",

  /** Emitted when command is received */
  COMMAND_RECEIVED: "command-received",

  /** Emitted when command result is reported */
  COMMAND_RESULT_REPORTED: "command-result-reported",

  /** Emitted when AI prompt is received */
  AI_PROMPT: "ai-prompt",

  /** Emitted when work context is reported */
  WORK_CONTEXT_REPORTED: "work-context-reported",

  /** Emitted on general message */
  MESSAGE: "message",

  /** Emitted on command */
  COMMAND: "command",

  /** Emitted on error */
  ERROR: "error",
} as const;

// =============================================================================
// Storage Configuration
// =============================================================================

/** OpenClaw directory name (inside user home) */
export const OPENCLAW_DIR_NAME = ".openclaw";

/** Registration file name */
export const REGISTRATION_FILE_NAME = "pinai-connector-registration.json";

// =============================================================================
// Device ID Configuration
// =============================================================================

/** Length of the hashed device ID */
export const DEVICE_ID_LENGTH = 16;

/** Null MAC address to ignore */
export const NULL_MAC_ADDRESS = "00:00:00:00:00:00";

// =============================================================================
// Default Export for Easy Access
// =============================================================================

export const CONFIG = {
  timing: {
    heartbeatInterval: DEFAULT_HEARTBEAT_INTERVAL_MS,
    qrCodeTimeout: DEFAULT_QR_CODE_TIMEOUT_MS,
    commandPollInterval: COMMAND_POLL_INTERVAL_MS,
    websocketReconnectDelay: WEBSOCKET_RECONNECT_DELAY_MS,
    registrationPollInterval: REGISTRATION_POLL_INTERVAL_MS,
    maxRegistrationAttempts: MAX_REGISTRATION_POLL_ATTEMPTS,
    workContextReportInterval: WORK_CONTEXT_REPORT_INTERVAL_MS,
    workContextTimeout: WORK_CONTEXT_TIMEOUT_MS,
  },
  api: {
    defaultBackendUrl: DEFAULT_BACKEND_URL,
    endpoints: API_ENDPOINTS,
  },
  storage: {
    dirName: OPENCLAW_DIR_NAME,
    registrationFileName: REGISTRATION_FILE_NAME,
  },
  device: {
    type: DEVICE_TYPE,
    namePrefix: DEVICE_NAME_PREFIX,
    idLength: DEVICE_ID_LENGTH,
  },
  events: CONNECTOR_EVENTS,
  commandTypes: COMMAND_TYPES,
} as const;

export default CONFIG;
