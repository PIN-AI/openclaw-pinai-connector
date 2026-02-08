/**
 * Registration Store
 * Persists Desktop Connector registration info to local filesystem
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConnectorRegistration } from "./types.js";

const OPENCLAW_DIR = join(homedir(), ".openclaw");
const REGISTRATION_FILE = join(OPENCLAW_DIR, "pinai-connector-registration.json");

/**
 * Save registration info to local file
 */
export function saveRegistration(registration: ConnectorRegistration): void {
  try {
    // Ensure .openclaw directory exists
    if (!existsSync(OPENCLAW_DIR)) {
      mkdirSync(OPENCLAW_DIR, { recursive: true });
    }

    // Write registration data
    writeFileSync(REGISTRATION_FILE, JSON.stringify(registration, null, 2), "utf-8");
    console.log(`[Registration] Saved to ${REGISTRATION_FILE}`);
  } catch (error) {
    console.error(`[Registration] Failed to save: ${error}`);
    throw error;
  }
}

/**
 * Load registration info from local file
 * Returns null if file doesn't exist or is invalid
 */
export function loadRegistration(): ConnectorRegistration | null {
  try {
    if (!existsSync(REGISTRATION_FILE)) {
      console.log("[Registration] No saved registration found");
      return null;
    }

    const data = readFileSync(REGISTRATION_FILE, "utf-8");
    const registration = JSON.parse(data) as ConnectorRegistration;

    // Validate required fields
    if (!registration.connectorId || !registration.token || !registration.deviceName) {
      console.warn("[Registration] Invalid registration data, missing required fields");
      return null;
    }

    console.log(`[Registration] Loaded connector_id: ${registration.connectorId}`);
    return registration;
  } catch (error) {
    console.error(`[Registration] Failed to load: ${error}`);
    return null;
  }
}

/**
 * Clear saved registration (e.g., on explicit disconnect)
 */
export function clearRegistration(): void {
  try {
    if (existsSync(REGISTRATION_FILE)) {
      unlinkSync(REGISTRATION_FILE);
      console.log("[Registration] Cleared saved registration");
    }
  } catch (error) {
    console.error(`[Registration] Failed to clear: ${error}`);
  }
}
