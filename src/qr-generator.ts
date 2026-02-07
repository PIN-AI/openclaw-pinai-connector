/**
 * QR Code Generator for Desktop Connector
 * Generates unique tokens and QR codes for app login
 */

import { randomBytes } from "node:crypto";
import type { QRCodeLoginToken } from "./types.js";

/**
 * Generate a unique login token for QR code
 */
export function generateLoginToken(): QRCodeLoginToken {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + 5 * 60 * 1000; // 5 minutes

  return {
    token,
    createdAt: now,
    expiresAt,
  };
}

/**
 * Check if a token is still valid
 */
export function isTokenValid(tokenData: QRCodeLoginToken): boolean {
  return Date.now() < tokenData.expiresAt;
}

/**
 * Generate QR code data URL
 * Format: pinai://connect?token=<token>&device=<deviceName>
 */
export function generateQRCodeData(token: string, deviceName: string): string {
  const params = new URLSearchParams({
    token,
    device: deviceName,
    type: "desktop",
  });
  return `pinai://connect?${params.toString()}`;
}
