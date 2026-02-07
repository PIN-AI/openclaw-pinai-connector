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

type RequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

type ResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message?: string };
};

type EventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
};

export async function callGatewayMethod<T = unknown>(
  opts: GatewayCallOptions,
): Promise<T> {
  const url = opts.url || "ws://127.0.0.1:18789";
  const timeoutMs = opts.timeoutMs || 10000;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let ws: WebSocket | null = null;
    let connected = false;

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

        // Send connect request
        const connectId = randomBytes(8).toString("hex");
        const connectFrame: RequestFrame = {
          type: "req",
          id: connectId,
          method: "connect",
          params: {
            minProtocol: 1,
            maxProtocol: 1,
            client: {
              id: "cli",
              version: "1.0.0",
              platform: process.platform,
              mode: "cli",
              instanceId: randomBytes(16).toString("hex"),
            },
            role: "operator",
            scopes: ["operator.admin"],
            caps: [],
            ...(opts.token ? { auth: { token: opts.token } } : {}),
          },
        };

        ws.send(JSON.stringify(connectFrame));
      });

      ws.on("message", (data) => {
        if (settled) return;

        try {
          const msg = JSON.parse(data.toString()) as ResponseFrame | EventFrame;

          if (msg.type === "event") {
            // Ignore events for now
            return;
          }

          if (msg.type === "res") {
            if (!connected) {
              // This is the connect response (hello-ok)
              if (msg.ok) {
                connected = true;
                // Now send the actual method call
                const callId = randomBytes(8).toString("hex");
                const callFrame: RequestFrame = {
                  type: "req",
                  id: callId,
                  method: opts.method,
                  params: opts.params || {},
                };
                ws?.send(JSON.stringify(callFrame));
              } else {
                settle(new Error(msg.error?.message || "Connect failed"));
              }
            } else {
              // This is the method call response
              if (msg.ok) {
                settle(undefined, msg.payload as T);
              } else {
                settle(new Error(msg.error?.message || "Gateway method failed"));
              }
            }
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
