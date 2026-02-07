/**
 * Simple Gateway Client for calling gateway methods
 */

import { WebSocket } from "ws";
import { randomBytes } from "node:crypto";

export type GatewayCallOptions = {
  url?: string;
  token?: string;
  method: string;
  params?: unknown;
  timeoutMs?: number;
};

export async function callGatewayMethod<T = unknown>(
  opts: GatewayCallOptions,
): Promise<T> {
  const url = opts.url || "ws://127.0.0.1:18789";
  const timeoutMs = opts.timeoutMs || 10000;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let ws: WebSocket | null = null;

    const cleanup = () => {
      if (ws) {
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        ws = null;
      }
    };

    const settle = (error?: Error, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve(result as T);
      }
    };

    const timer = setTimeout(() => {
      settle(new Error(`Gateway timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      ws = new WebSocket(url);

      ws.on("error", (error) => {
        settle(new Error(`Gateway connection error: ${error.message}`));
      });

      ws.on("close", (code, reason) => {
        if (!settled) {
          settle(new Error(`Gateway closed: ${code} ${reason.toString()}`));
        }
      });

      ws.on("open", () => {
        if (!ws || settled) return;

        // Send hello message
        const helloMsg = {
          type: "hello",
          protocol: 1,
          clientName: "pinai-cli",
          clientVersion: "1.0.0",
          instanceId: randomBytes(16).toString("hex"),
          mode: "cli",
          role: "operator",
          scopes: ["operator.admin"],
          ...(opts.token ? { token: opts.token } : {}),
        };

        ws.send(JSON.stringify(helloMsg));
      });

      ws.on("message", (data) => {
        if (settled) return;

        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === "hello-ok") {
            // Send method call
            const callMsg = {
              type: "call",
              id: randomBytes(8).toString("hex"),
              method: opts.method,
              params: opts.params || {},
            };
            ws?.send(JSON.stringify(callMsg));
          } else if (msg.type === "result") {
            // Got result
            if (msg.ok) {
              settle(undefined, msg.value as T);
            } else {
              settle(new Error(msg.error?.message || "Gateway method failed"));
            }
          } else if (msg.type === "error") {
            settle(new Error(msg.message || "Gateway error"));
          }
        } catch (error) {
          settle(new Error(`Failed to parse gateway message: ${error}`));
        }
      });
    } catch (error) {
      settle(error as Error);
    }
  });
}
