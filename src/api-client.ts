/**
 * API Client
 *
 * Centralized HTTP client for PINAI backend API calls.
 * Handles request/response formatting, error handling, and logging.
 */

import { API_ENDPOINTS } from "./constants.js";
import { connectorLogger as logger, formatTokenForLog } from "./logger.js";

// =============================================================================
// Types
// =============================================================================

/** API response wrapper */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
}

/** QR Token response from backend */
export interface QRTokenResponse {
  token: string;
  qr_data: string;
  expires_in: number;
}

/** Login status response from backend */
export interface LoginStatusResponse {
  registered: boolean;
  expired: boolean;
  connector_id?: string;
  device_name?: string;
}

/** Command from backend */
export interface BackendCommand {
  command_id: string;
  command_type: string;
  command_payload: { prompt: string };
  priority: number;
  created_at: string;
}

/** Heartbeat payload for backend (snake_case) */
export interface HeartbeatBackendPayload {
  connector_id: string;
  status: "online" | "offline";
  timestamp: number;
  work_status?: {
    last_activity?: number;
    work_context?: {
      summary: string;
      session_count: number;
      period_hours: number;
    };
  };
}

// =============================================================================
// API Client Class
// =============================================================================

/**
 * PINAI Backend API Client
 *
 * Provides typed methods for all backend API endpoints with
 * consistent error handling and logging.
 */
export class ApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  // ===========================================================================
  // Core HTTP Methods
  // ===========================================================================

  /**
   * Make a GET request to the API
   */
  private async get<T>(endpoint: string, params?: Record<string, string>): Promise<ApiResponse<T>> {
    const url = new URL(endpoint, this.baseUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    return this.request<T>("GET", url.toString());
  }

  /**
   * Make a POST request to the API
   */
  private async post<T>(
    endpoint: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    const url = new URL(endpoint, this.baseUrl).toString();
    return this.request<T>("POST", url, body, headers);
  }

  /**
   * Core request method with error handling
   */
  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...extraHeaders,
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && method !== "GET") {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const responseBody = await this.parseResponse<T>(response);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          status: response.status,
        };
      }

      return {
        success: true,
        data: responseBody,
        status: response.status,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("API request failed", error);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Parse response body safely
   */
  private async parseResponse<T>(response: Response): Promise<T | undefined> {
    const contentType = response.headers.get("content-type");

    if (contentType?.includes("application/json")) {
      try {
        return (await response.json()) as T;
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  // ===========================================================================
  // QR Code & Registration
  // ===========================================================================

  /**
   * Request a new QR token from the backend
   */
  async createQRToken(
    deviceName: string,
    deviceType: string,
    deviceId: string,
  ): Promise<ApiResponse<QRTokenResponse>> {
    logger.separator("Creating QR Token (Desktop)");

    const body = {
      device_name: deviceName,
      device_type: deviceType,
      device_id: deviceId,
    };

    logger.logRequest("POST", `${this.baseUrl}${API_ENDPOINTS.QR_TOKEN}`, body);

    const response = await this.post<QRTokenResponse>(API_ENDPOINTS.QR_TOKEN, body);

    if (response.success && response.data) {
      logger.debug("QR Token created successfully");
      logger.debug(`Token: ${formatTokenForLog(response.data.token)}`);
      logger.debug(`Expires in: ${response.data.expires_in} seconds`);
    }

    return response;
  }

  /**
   * Check if QR token has been scanned and registered
   */
  async checkLoginStatus(token: string): Promise<ApiResponse<LoginStatusResponse>> {
    return this.get<LoginStatusResponse>(API_ENDPOINTS.CHECK_LOGIN_STATUS, { token });
  }

  /**
   * Register a new connector
   */
  async register(
    token: string,
    userId: string,
    deviceName: string,
    deviceType: string,
  ): Promise<
    ApiResponse<{
      connectorId: string;
    }>
  > {
    return this.post(API_ENDPOINTS.REGISTER, {
      token,
      userId,
      deviceName,
      deviceType,
    });
  }

  // ===========================================================================
  // Heartbeat
  // ===========================================================================

  /**
   * Send heartbeat to backend
   */
  async sendHeartbeat(
    payload: HeartbeatBackendPayload,
    authToken: string,
  ): Promise<ApiResponse<void>> {
    return this.post(API_ENDPOINTS.HEARTBEAT, payload, {
      Authorization: `Bearer ${authToken}`,
    });
  }

  // ===========================================================================
  // Commands
  // ===========================================================================

  /**
   * Poll for pending commands
   */
  async pollCommands(connectorId: string, limit = 10): Promise<ApiResponse<BackendCommand[]>> {
    return this.get<BackendCommand[]>(API_ENDPOINTS.COMMANDS_POLL, {
      connector_id: connectorId,
      limit: limit.toString(),
    });
  }

  /**
   * Report command execution result
   */
  async reportCommandResult(
    commandId: string,
    connectorId: string,
    status: "completed" | "failed",
    result?: unknown,
    errorMessage?: string | null,
  ): Promise<ApiResponse<void>> {
    return this.post(API_ENDPOINTS.COMMANDS_RESULT, {
      command_id: commandId,
      connector_id: connectorId,
      status,
      result: result ?? null,
      error_message: errorMessage ?? null,
    });
  }

  // ===========================================================================
  // Work Context
  // ===========================================================================

  /**
   * Report work context to backend
   */
  async reportWorkContext(
    connectorId: string,
    summary: string,
    reportedAt: number,
  ): Promise<ApiResponse<void>> {
    return this.post(API_ENDPOINTS.WORK_CONTEXT, {
      connector_id: connectorId,
      summary,
      reported_at: reportedAt,
    });
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Notify backend of disconnection
   */
  async disconnect(connectorId: string, authToken: string): Promise<ApiResponse<void>> {
    return this.post(
      API_ENDPOINTS.DISCONNECT,
      { connectorId },
      { Authorization: `Bearer ${authToken}` },
    );
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an API client instance
 */
export function createApiClient(baseUrl: string): ApiClient {
  return new ApiClient(baseUrl);
}

export default ApiClient;
