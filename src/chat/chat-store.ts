/**
 * AgentHub Chat Credentials Storage
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AgentHubCredentials } from "./types.js";

const CREDENTIALS_FILE = path.join(
  os.homedir(),
  ".openclaw",
  "pinai-agenthub-credentials.json"
);

/**
 * Load AgentHub credentials from disk
 */
export function loadAgentHubCredentials(): AgentHubCredentials | null {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) {
      return null;
    }
    const data = fs.readFileSync(CREDENTIALS_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`[Chat Store] Failed to load credentials: ${error}`);
    return null;
  }
}

/**
 * Save AgentHub credentials to disk
 */
export function saveAgentHubCredentials(credentials: AgentHubCredentials): void {
  try {
    const dir = path.dirname(CREDENTIALS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      CREDENTIALS_FILE,
      JSON.stringify(credentials, null, 2),
      "utf-8"
    );
  } catch (error) {
    throw new Error(`Failed to save credentials: ${error}`);
  }
}

/**
 * Update the enabled status
 */
export function updateChatEnabled(enabled: boolean): void {
  const credentials = loadAgentHubCredentials();
  if (!credentials) {
    throw new Error("No credentials found. Register first.");
  }
  credentials.enabled = enabled;
  saveAgentHubCredentials(credentials);
}

/**
 * Update last heartbeat timestamp
 */
export function updateLastHeartbeat(timestamp: number): void {
  const credentials = loadAgentHubCredentials();
  if (!credentials) {
    return;
  }
  credentials.lastHeartbeat = timestamp;
  saveAgentHubCredentials(credentials);
}

/**
 * Add a processed message ID
 */
export function addProcessedMessageId(messageId: string): void {
  const credentials = loadAgentHubCredentials();
  if (!credentials) {
    return;
  }
  if (!credentials.processedMessageIds) {
    credentials.processedMessageIds = [];
  }
  credentials.processedMessageIds.push(messageId);

  // Keep only last 1000 message IDs to prevent file bloat
  if (credentials.processedMessageIds.length > 1000) {
    credentials.processedMessageIds = credentials.processedMessageIds.slice(-1000);
  }

  saveAgentHubCredentials(credentials);
}

/**
 * Check if a message has been processed
 */
export function isMessageProcessed(messageId: string): boolean {
  const credentials = loadAgentHubCredentials();
  if (!credentials || !credentials.processedMessageIds) {
    return false;
  }
  return credentials.processedMessageIds.includes(messageId);
}
