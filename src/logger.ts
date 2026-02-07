/**
 * Desktop Connector Logger
 *
 * Provides consistent logging format for the PINAI Desktop Connector.
 * Supports different log levels and module-specific prefixes.
 */

// =============================================================================
// Types
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  /** Module name for prefix */
  module: string;
  /** Whether verbose logging is enabled */
  verbose?: boolean;
}

// =============================================================================
// Logger Class
// =============================================================================

/**
 * Module-specific logger with consistent formatting
 */
export class Logger {
  private readonly module: string;
  private verbose: boolean;

  constructor(options: LoggerOptions) {
    this.module = options.module;
    this.verbose = options.verbose ?? true;
  }

  /**
   * Set verbose mode
   */
  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  /**
   * Format log prefix with module name and optional timestamp
   */
  private formatPrefix(level: LogLevel): string {
    const icon = LOG_ICONS[level];
    return `${icon} [${this.module}]`;
  }

  /**
   * Debug level log (only when verbose)
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.verbose) {
      console.log(`${this.formatPrefix("debug")} ${message}`, ...args);
    }
  }

  /**
   * Info level log
   */
  info(message: string, ...args: unknown[]): void {
    console.log(`${this.formatPrefix("info")} ${message}`, ...args);
  }

  /**
   * Success log (special info variant)
   */
  success(message: string, ...args: unknown[]): void {
    console.log(`✅ [${this.module}] ${message}`, ...args);
  }

  /**
   * Warning level log
   */
  warn(message: string, ...args: unknown[]): void {
    console.warn(`${this.formatPrefix("warn")} ${message}`, ...args);
  }

  /**
   * Error level log
   */
  error(message: string, error?: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error ?? "");
    const fullMessage = errorMessage ? `${message}: ${errorMessage}` : message;
    console.error(`${this.formatPrefix("error")} ${fullMessage}`);
  }

  /**
   * Log API request details (debug level)
   */
  logRequest(method: string, url: string, body?: unknown): void {
    if (!this.verbose) return;

    console.log(`\n📡 [${this.module}] API Request`);
    console.log(`  Method: ${method}`);
    console.log(`  URL: ${url}`);
    if (body) {
      console.log(`  Body:`, JSON.stringify(body, null, 2));
    }
  }

  /**
   * Log API response details (debug level)
   */
  logResponse(status: number, statusText: string, body?: unknown): void {
    if (!this.verbose) return;

    console.log(`📥 [${this.module}] API Response`);
    console.log(`  Status: ${status} ${statusText}`);
    if (body) {
      console.log(`  Body:`, typeof body === "string" ? body : JSON.stringify(body, null, 2));
    }
  }

  /**
   * Log a separator line
   */
  separator(title?: string): void {
    if (!this.verbose) return;

    if (title) {
      console.log(`\n=== ${title} ===\n`);
    } else {
      console.log("\n" + "=".repeat(50) + "\n");
    }
  }
}

// =============================================================================
// Constants
// =============================================================================

const LOG_ICONS: Record<LogLevel, string> = {
  debug: "🔍",
  info: "ℹ️ ",
  warn: "⚠️ ",
  error: "❌",
};

// =============================================================================
// Module Loggers
// =============================================================================

/** Pre-configured logger for Connector Manager */
export const connectorLogger = new Logger({ module: "Connector" });

/** Pre-configured logger for Registration */
export const registrationLogger = new Logger({ module: "Registration" });

/** Pre-configured logger for Device ID */
export const deviceLogger = new Logger({ module: "Device ID" });

/** Pre-configured logger for QR Code */
export const qrLogger = new Logger({ module: "QR Code" });

/** Pre-configured logger for Work Context */
export const workContextLogger = new Logger({ module: "Work Context" });

/** Pre-configured logger for Heartbeat */
export const heartbeatLogger = new Logger({ module: "Heartbeat" });

/** Pre-configured logger for Commands */
export const commandLogger = new Logger({ module: "Commands" });

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new logger for a specific module
 */
export function createLogger(module: string, verbose = true): Logger {
  return new Logger({ module, verbose });
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format a token for safe logging (shows first N characters + length)
 */
export function formatTokenForLog(token: string, visibleChars = 16): string {
  if (token.length <= visibleChars) {
    return token;
  }
  return `${token.substring(0, visibleChars)}... (length: ${token.length})`;
}

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export default Logger;
