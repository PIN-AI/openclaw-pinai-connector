/**
 * Gateway RPC Client
 * Allows CLI commands to call gateway methods
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Call a gateway method via HTTP RPC
 */
export async function callGatewayMethod(method: string, params?: any): Promise<any> {
  const gatewayPort = getGatewayPort();

  try {
    const response = await fetch(`http://localhost:${gatewayPort}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params: params || {},
        id: Date.now(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Gateway request failed: ${response.status}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error.message || "Gateway method failed");
    }

    return result.result;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed")) {
        throw new Error("Cannot connect to gateway. Is it running?");
      }
      throw error;
    }
    throw new Error(String(error));
  }
}

/**
 * Get gateway port from config
 */
function getGatewayPort(): number {
  try {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    return config.gateway?.port || 3000;
  } catch {
    return 3000; // Default port
  }
}
