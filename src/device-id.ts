/**
 * Device ID Generator
 * Generates a stable device identifier based on MAC address
 */

import crypto from "node:crypto";
import os from "node:os";

/**
 * Get the first non-internal MAC address
 */
function getMacAddress(): string | null {
  const interfaces = os.networkInterfaces();

  for (const [, nets] of Object.entries(interfaces)) {
    if (!nets) continue;

    for (const net of nets) {
      // Skip internal/loopback interfaces
      if (net.internal) continue;

      // Get MAC address
      if (net.mac && net.mac !== "00:00:00:00:00:00") {
        return net.mac;
      }
    }
  }

  return null;
}

/**
 * Generate a stable device ID based on MAC address
 * Returns a hash of the MAC address for privacy
 */
export function getDeviceId(): string {
  const mac = getMacAddress();

  console.log("[Device ID] Generating device ID...");
  console.log(`[Device ID] MAC address found: ${mac ? "Yes" : "No"}`);

  if (!mac) {
    // Fallback: use hostname if MAC address is not available
    const hostname = os.hostname();
    console.log(`[Device ID] Using hostname fallback: "${hostname}"`);

    if (!hostname || hostname.trim() === "") {
      // Second fallback: use platform + arch + random
      const fallback = `${os.platform()}-${os.arch()}-${Date.now()}`;
      console.log(`[Device ID] Hostname empty, using fallback: "${fallback}"`);
      const hash = crypto.createHash("sha256").update(fallback).digest("hex");
      const deviceId = hash.substring(0, 16); // Shorter ID for fallback
      console.log(`[Device ID] Generated fallback device ID: ${deviceId}`);
      return deviceId;
    }

    const hash = crypto.createHash("sha256").update(hostname).digest("hex");
    const deviceId = hash.substring(0, 16);
    console.log(`[Device ID] Generated device ID from hostname: ${deviceId}`);
    return deviceId;
  }

  // Hash the MAC address for privacy (don't expose raw MAC)
  const hash = crypto.createHash("sha256").update(mac).digest("hex");
  const deviceId = hash.substring(0, 16);
  console.log(`[Device ID] Generated device ID from MAC: ${deviceId}`);
  return deviceId;
}

/**
 * Get raw MAC address (for debugging)
 */
export function getRawMacAddress(): string | null {
  return getMacAddress();
}

/**
 * Get device info for display
 */
export function getDeviceInfo(): {
  deviceId: string;
  hostname: string;
  platform: string;
  arch: string;
  hasMac: boolean;
} {
  return {
    deviceId: getDeviceId(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    hasMac: getMacAddress() !== null,
  };
}
