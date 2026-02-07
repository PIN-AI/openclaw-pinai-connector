/**
 * Error Handler Module
 *
 * Provides comprehensive error handling, recovery mechanisms,
 * and data caching for network failures.
 */

import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "./logger.js";

const logger = createLogger("ErrorHandler");

// =============================================================================
// Types
// =============================================================================

export type ErrorSeverity = "low" | "medium" | "high" | "critical";

export type ErrorCategory =
  | "network"
  | "authentication"
  | "validation"
  | "timeout"
  | "server"
  | "client"
  | "unknown";

export interface ConnectorError {
  code: string;
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  timestamp: number;
  retryable: boolean;
  context?: Record<string, unknown>;
  originalError?: Error;
}

export interface PendingData {
  type: "heartbeat" | "command-result" | "work-context";
  payload: unknown;
  timestamp: number;
  attempts: number;
  maxAttempts: number;
}

export interface ErrorStats {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  lastError: ConnectorError | null;
  consecutiveFailures: number;
  lastSuccessTime: number | null;
}

export interface RecoveryStrategy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
}

// =============================================================================
// Constants
// =============================================================================

const CACHE_DIR = join(homedir(), ".openclaw", "connector-cache");
const PENDING_DATA_FILE = join(CACHE_DIR, "pending-data.json");

const ERROR_CODES = {
  // Network errors
  NETWORK_OFFLINE: { code: "E001", category: "network" as const, severity: "high" as const },
  NETWORK_TIMEOUT: { code: "E002", category: "timeout" as const, severity: "medium" as const },
  NETWORK_DNS: { code: "E003", category: "network" as const, severity: "high" as const },

  // Server errors
  SERVER_UNAVAILABLE: { code: "E101", category: "server" as const, severity: "high" as const },
  SERVER_INTERNAL: { code: "E102", category: "server" as const, severity: "medium" as const },
  SERVER_RATE_LIMIT: { code: "E103", category: "server" as const, severity: "low" as const },

  // Authentication errors
  AUTH_INVALID_TOKEN: { code: "E201", category: "authentication" as const, severity: "critical" as const },
  AUTH_EXPIRED: { code: "E202", category: "authentication" as const, severity: "high" as const },
  AUTH_UNAUTHORIZED: { code: "E203", category: "authentication" as const, severity: "critical" as const },

  // Validation errors
  VALIDATION_FAILED: { code: "E301", category: "validation" as const, severity: "low" as const },
  INVALID_RESPONSE: { code: "E302", category: "validation" as const, severity: "medium" as const },

  // Client errors
  CLIENT_DISCONNECTED: { code: "E401", category: "client" as const, severity: "medium" as const },
  CLIENT_STATE_INVALID: { code: "E402", category: "client" as const, severity: "high" as const },

  // Unknown errors
  UNKNOWN: { code: "E999", category: "unknown" as const, severity: "medium" as const },
} as const;

const DEFAULT_RECOVERY_STRATEGY: RecoveryStrategy = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterFactor: 0.3,
};

// =============================================================================
// Error Handler Class
// =============================================================================

export class ErrorHandler extends EventEmitter {
  private stats: ErrorStats;
  private pendingData: PendingData[] = [];
  private recoveryStrategy: RecoveryStrategy;
  private isOnline: boolean = true;
  private syncTimer: NodeJS.Timeout | null = null;

  constructor(strategy?: Partial<RecoveryStrategy>) {
    super();
    this.recoveryStrategy = { ...DEFAULT_RECOVERY_STRATEGY, ...strategy };
    this.stats = this.createInitialStats();
    this.loadPendingData();
    this.setupNetworkMonitoring();
  }

  // ===========================================================================
  // Error Creation and Classification
  // ===========================================================================

  /**
   * Create a standardized error from any error type
   */
  createError(
    error: unknown,
    context?: Record<string, unknown>
  ): ConnectorError {
    const originalError = error instanceof Error ? error : new Error(String(error));
    const classification = this.classifyError(originalError);

    const connectorError: ConnectorError = {
      code: classification.code,
      message: originalError.message,
      category: classification.category,
      severity: classification.severity,
      timestamp: Date.now(),
      retryable: this.isRetryable(classification.category, classification.severity),
      context,
      originalError,
    };

    this.recordError(connectorError);
    return connectorError;
  }

  /**
   * Classify an error based on its type and message
   */
  private classifyError(error: Error): { code: string; category: ErrorCategory; severity: ErrorSeverity } {
    const message = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();

    // Network errors
    if (message.includes("enotfound") || message.includes("dns")) {
      return ERROR_CODES.NETWORK_DNS;
    }
    if (message.includes("econnrefused") || message.includes("network")) {
      return ERROR_CODES.NETWORK_OFFLINE;
    }
    if (message.includes("timeout") || message.includes("etimedout")) {
      return ERROR_CODES.NETWORK_TIMEOUT;
    }

    // Server errors
    if (message.includes("503") || message.includes("service unavailable")) {
      return ERROR_CODES.SERVER_UNAVAILABLE;
    }
    if (message.includes("500") || message.includes("internal server")) {
      return ERROR_CODES.SERVER_INTERNAL;
    }
    if (message.includes("429") || message.includes("rate limit")) {
      return ERROR_CODES.SERVER_RATE_LIMIT;
    }

    // Authentication errors
    if (message.includes("401") || message.includes("unauthorized")) {
      return ERROR_CODES.AUTH_UNAUTHORIZED;
    }
    if (message.includes("403") || message.includes("forbidden")) {
      return ERROR_CODES.AUTH_INVALID_TOKEN;
    }
    if (message.includes("token") && message.includes("expired")) {
      return ERROR_CODES.AUTH_EXPIRED;
    }

    // Validation errors
    if (message.includes("400") || message.includes("bad request")) {
      return ERROR_CODES.VALIDATION_FAILED;
    }
    if (message.includes("invalid") && message.includes("response")) {
      return ERROR_CODES.INVALID_RESPONSE;
    }

    return ERROR_CODES.UNKNOWN;
  }

  /**
   * Check if an error is retryable
   */
  private isRetryable(category: ErrorCategory, severity: ErrorSeverity): boolean {
    // Critical errors and authentication errors are not retryable
    if (severity === "critical" || category === "authentication") {
      return false;
    }

    // Network and server errors are usually retryable
    if (category === "network" || category === "server" || category === "timeout") {
      return true;
    }

    return false;
  }

  // ===========================================================================
  // Error Statistics
  // ===========================================================================

  /**
   * Record an error in statistics
   */
  private recordError(error: ConnectorError): void {
    this.stats.totalErrors++;
    this.stats.errorsByCategory[error.category]++;
    this.stats.errorsBySeverity[error.severity]++;
    this.stats.lastError = error;
    this.stats.consecutiveFailures++;

    this.emit("error-recorded", error);

    // Check for circuit breaker condition
    if (this.stats.consecutiveFailures >= 10) {
      this.emit("circuit-breaker-triggered", this.stats);
    }
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.stats.consecutiveFailures = 0;
    this.stats.lastSuccessTime = Date.now();
    this.emit("success-recorded");
  }

  /**
   * Get current error statistics
   */
  getStats(): ErrorStats {
    return { ...this.stats };
  }

  /**
   * Reset error statistics
   */
  resetStats(): void {
    this.stats = this.createInitialStats();
    this.emit("stats-reset");
  }

  private createInitialStats(): ErrorStats {
    return {
      totalErrors: 0,
      errorsByCategory: {
        network: 0,
        authentication: 0,
        validation: 0,
        timeout: 0,
        server: 0,
        client: 0,
        unknown: 0,
      },
      errorsBySeverity: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      },
      lastError: null,
      consecutiveFailures: 0,
      lastSuccessTime: null,
    };
  }

  // ===========================================================================
  // Retry Logic with Exponential Backoff
  // ===========================================================================

  /**
   * Calculate delay for retry with exponential backoff and jitter
   */
  calculateRetryDelay(attempt: number): number {
    const { baseDelayMs, maxDelayMs, backoffMultiplier, jitterFactor } = this.recoveryStrategy;

    // Exponential backoff
    let delay = baseDelayMs * Math.pow(backoffMultiplier, attempt);

    // Cap at max delay
    delay = Math.min(delay, maxDelayMs);

    // Add jitter to prevent thundering herd
    const jitter = delay * jitterFactor * (Math.random() * 2 - 1);
    delay = Math.max(0, delay + jitter);

    return Math.round(delay);
  }

  /**
   * Execute a function with retry logic
   */
  async withRetry<T>(
    fn: () => Promise<T>,
    context: string,
    customStrategy?: Partial<RecoveryStrategy>
  ): Promise<T> {
    const strategy = { ...this.recoveryStrategy, ...customStrategy };
    let lastError: ConnectorError | null = null;

    for (let attempt = 0; attempt < strategy.maxRetries; attempt++) {
      try {
        const result = await fn();
        this.recordSuccess();
        return result;
      } catch (error) {
        lastError = this.createError(error, { context, attempt });

        if (!lastError.retryable || attempt >= strategy.maxRetries - 1) {
          throw lastError;
        }

        const delay = this.calculateRetryDelay(attempt);
        logger.warn(`Retry ${attempt + 1}/${strategy.maxRetries} for ${context} in ${delay}ms`);

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===========================================================================
  // Data Caching for Offline Support
  // ===========================================================================

  /**
   * Cache data for later synchronization
   */
  cacheForSync(type: PendingData["type"], payload: unknown): void {
    const pendingItem: PendingData = {
      type,
      payload,
      timestamp: Date.now(),
      attempts: 0,
      maxAttempts: 3,
    };

    this.pendingData.push(pendingItem);
    this.savePendingData();

    logger.info(`Cached ${type} data for sync (total: ${this.pendingData.length})`);
    this.emit("data-cached", pendingItem);
  }

  /**
   * Get pending data for synchronization
   */
  getPendingData(): PendingData[] {
    return [...this.pendingData];
  }

  /**
   * Mark pending data as synced (remove from cache)
   */
  markSynced(index: number): void {
    if (index >= 0 && index < this.pendingData.length) {
      this.pendingData.splice(index, 1);
      this.savePendingData();
    }
  }

  /**
   * Increment attempt counter for pending data
   */
  incrementAttempt(index: number): boolean {
    if (index >= 0 && index < this.pendingData.length) {
      this.pendingData[index].attempts++;

      // Remove if max attempts reached
      if (this.pendingData[index].attempts >= this.pendingData[index].maxAttempts) {
        logger.warn(`Max sync attempts reached for item ${index}, removing`);
        this.pendingData.splice(index, 1);
        this.savePendingData();
        return false;
      }

      this.savePendingData();
      return true;
    }
    return false;
  }

  /**
   * Save pending data to disk
   */
  private savePendingData(): void {
    try {
      if (!existsSync(CACHE_DIR)) {
        mkdirSync(CACHE_DIR, { recursive: true });
      }
      writeFileSync(PENDING_DATA_FILE, JSON.stringify(this.pendingData, null, 2));
    } catch (error) {
      logger.error("Failed to save pending data", error);
    }
  }

  /**
   * Load pending data from disk
   */
  private loadPendingData(): void {
    try {
      if (existsSync(PENDING_DATA_FILE)) {
        const data = readFileSync(PENDING_DATA_FILE, "utf-8");
        this.pendingData = JSON.parse(data);
        logger.info(`Loaded ${this.pendingData.length} pending items from cache`);
      }
    } catch (error) {
      logger.error("Failed to load pending data", error);
      this.pendingData = [];
    }
  }

  /**
   * Clear all pending data
   */
  clearPendingData(): void {
    this.pendingData = [];
    try {
      if (existsSync(PENDING_DATA_FILE)) {
        unlinkSync(PENDING_DATA_FILE);
      }
    } catch (error) {
      logger.error("Failed to clear pending data file", error);
    }
  }

  // ===========================================================================
  // Network Monitoring
  // ===========================================================================

  private setupNetworkMonitoring(): void {
    // Periodic network check
    this.syncTimer = setInterval(() => {
      this.checkNetworkAndSync();
    }, 30000); // Check every 30 seconds
  }

  private async checkNetworkAndSync(): Promise<void> {
    const wasOffline = !this.isOnline;

    try {
      // Simple connectivity check
      const response = await fetch("https://www.google.com/generate_204", {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });

      this.isOnline = response.ok || response.status === 204;
    } catch {
      this.isOnline = false;
    }

    // Network status changed from offline to online
    if (wasOffline && this.isOnline) {
      logger.info("Network restored, triggering sync");
      this.emit("network-restored");
    }

    // Network went offline
    if (!wasOffline && !this.isOnline) {
      logger.warn("Network disconnected");
      this.emit("network-lost");
    }
  }

  /**
   * Check if network is available
   */
  isNetworkAvailable(): boolean {
    return this.isOnline;
  }

  // ===========================================================================
  // Graceful Degradation
  // ===========================================================================

  /**
   * Get degraded functionality level based on error state
   */
  getDegradedLevel(): "full" | "limited" | "offline" {
    if (!this.isOnline) {
      return "offline";
    }

    if (this.stats.consecutiveFailures >= 5) {
      return "limited";
    }

    return "full";
  }

  /**
   * Check if a specific feature should be enabled
   */
  shouldEnableFeature(feature: "heartbeat" | "commands" | "work-context"): boolean {
    const level = this.getDegradedLevel();

    switch (level) {
      case "offline":
        return false;
      case "limited":
        // In limited mode, only allow heartbeat
        return feature === "heartbeat";
      case "full":
        return true;
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Stop the error handler and cleanup
   */
  destroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.savePendingData();
    this.removeAllListeners();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createErrorHandler(strategy?: Partial<RecoveryStrategy>): ErrorHandler {
  return new ErrorHandler(strategy);
}

export default ErrorHandler;
