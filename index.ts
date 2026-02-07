/**
 * PINAI Connector Plugin
 * Desktop connector for PINAI mobile app integration
 */

import os from "node:os";
import crypto from "node:crypto";
import qrcode from "qrcode-terminal";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { DesktopConnectorManager } from "./src/connector-manager.js";
import type { DesktopConnectorConfig } from "./src/types.js";

const pinaiConnectorPlugin = {
  id: "pinai-connector",
  name: "PINAI Connector",
  description: "Desktop connector for PINAI mobile app integration via QR code authentication",
  version: "2026.2.1",

  configSchema: {
    parse(value: unknown): DesktopConnectorConfig {
      const raw =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};

      return {
        enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
        backendUrl:
          typeof raw.backendUrl === "string"
            ? raw.backendUrl
            : "https://dev-mining.api.pinai.tech",
        heartbeatIntervalMs:
          typeof raw.heartbeatIntervalMs === "number" ? raw.heartbeatIntervalMs : 30000,
        qrCodeTimeoutMs:
          typeof raw.qrCodeTimeoutMs === "number" ? raw.qrCodeTimeoutMs : 300000,
      };
    },
    uiHints: {
      enabled: {
        label: "Enable PINAI Connector",
        help: "Enable desktop connector for PINAI mobile app",
      },
      backendUrl: {
        label: "Backend URL",
        help: "PINAI backend API URL",
        placeholder: "https://dev-mining.api.pinai.tech",
      },
      heartbeatIntervalMs: {
        label: "Heartbeat Interval (ms)",
        help: "How often to send heartbeat to backend",
        advanced: true,
      },
      qrCodeTimeoutMs: {
        label: "QR Code Timeout (ms)",
        help: "QR code expiration timeout",
        advanced: true,
      },
      showQrCode: {
        label: "Show QR Code",
        help: "Display QR code in console",
        advanced: true,
      },
      verbose: {
        label: "Verbose Logging",
        help: "Enable detailed logging",
        advanced: true,
      },
    },
  },

  register(api: OpenClawPluginApi) {
    const config = pinaiConnectorPlugin.configSchema.parse(api.pluginConfig);
    const showQrCode =
      api.pluginConfig && typeof api.pluginConfig === "object"
        ? (api.pluginConfig as Record<string, unknown>).showQrCode !== false
        : true;
    const verbose =
      api.pluginConfig && typeof api.pluginConfig === "object"
        ? (api.pluginConfig as Record<string, unknown>).verbose !== false
        : true;

    let connectorManager: DesktopConnectorManager | null = null;

    // Register service for background operations
    api.registerService({
      id: "pinai-connector",

      async start(ctx) {
        if (!config.enabled) {
          ctx.logger.info("[PINAI Connector] Disabled in config");
          return;
        }

        try {
          // Initialize connector manager
          connectorManager = new DesktopConnectorManager(config);

          // Check if already registered from saved state
          const status = connectorManager.getStatus();

          if (status.registration) {
            if (verbose) {
              ctx.logger.info("[PINAI Connector] Using saved registration");
              ctx.logger.info(`  Connector ID: ${status.registration.connectorId}`);
              ctx.logger.info(`  Device: ${status.registration.deviceName}`);
            }
          } else {
            // Generate and display QR code
            const hostname = os.hostname();
            const deviceName = `PINAI-Desktop-${hostname}`;

            if (verbose) {
              ctx.logger.info(`[PINAI Connector] Generating QR code for device: ${deviceName}`);
            }

            const { qrData, token } = await connectorManager.generateQRCode(deviceName);

            if (showQrCode) {
              console.log("\n=== Scan this QR code with PINAI App ===\n");
              qrcode.generate(qrData, { small: true });
              console.log("\nQR Code Details:");
              console.log(`  Device: ${deviceName}`);
              console.log(`  Token: ${token.substring(0, 16)}...`);
              console.log("\nWaiting for app to scan...\n");
            }
          }

          // Listen for AI prompt commands from backend
          connectorManager.on("ai-prompt", async (data: { commandId: string; prompt: string }) => {
            if (verbose) {
              console.log(`\n${"=".repeat(80)}`);
              console.log(`[PINAI Command] Received AI prompt`);
              console.log(`Command ID: ${data.commandId}`);
              console.log(`Prompt: ${data.prompt}`);
              console.log(`${"=".repeat(80)}\n`);
            }

            try {
              // Execute the prompt using OpenClaw's embedded agent
              const { runEmbeddedPiAgent } = await import(
                "../../src/agents/pi-embedded.js"
              );
              const { resolveSessionTranscriptPath } = await import(
                "../../src/config/sessions.js"
              );
              const { resolveOpenClawAgentDir } = await import(
                "../../src/agents/agent-paths.js"
              );
              const { DEFAULT_AGENT_ID } = await import("../../src/routing/session-key.js");
              const { DEFAULT_MODEL, DEFAULT_PROVIDER } = await import(
                "../../src/agents/defaults.js"
              );

              const sessionId = `pinai-command-${data.commandId}`;
              const sessionFile = resolveSessionTranscriptPath(sessionId, DEFAULT_AGENT_ID);
              const agentDir = resolveOpenClawAgentDir();
              const workspaceDir = ctx.workspaceDir || process.cwd();

              if (verbose) {
                console.log(`[PINAI Command] Executing with OpenClaw AI...`);
              }

              const result = await runEmbeddedPiAgent({
                sessionId,
                sessionFile,
                workspaceDir,
                agentDir,
                config: ctx.config,
                prompt: data.prompt,
                provider: DEFAULT_PROVIDER,
                model: DEFAULT_MODEL,
                thinkLevel: "low",
                timeoutMs: 120000, // 2 minutes timeout
                runId: crypto.randomUUID(),
              });

              // Extract response from payloads
              let response = "";
              if (result.payloads && result.payloads.length > 0) {
                response = result.payloads
                  .map((p) => p.text || "")
                  .filter((t) => t.length > 0)
                  .join("\n")
                  .trim();
              }

              if (!response || response.length < 1) {
                response = "Command executed but no output was generated.";
              }

              if (verbose) {
                console.log(`\n${"=".repeat(80)}`);
                console.log(`[PINAI Command] Execution completed successfully`);
                console.log(`Command ID: ${data.commandId}`);
                console.log(`Response length: ${response.length} chars`);
                console.log(`${"=".repeat(80)}\n`);
              }

              // Report success to backend
              await connectorManager!.reportCommandResult(
                data.commandId,
                "completed",
                { response },
                null,
              );

              if (verbose) {
                console.log(`[PINAI Command] Result reported to backend (status: completed)`);
              }
            } catch (error) {
              if (verbose) {
                console.log(`\n${"=".repeat(80)}`);
                console.error(`[PINAI Command] Execution failed`);
                console.error(`Command ID: ${data.commandId}`);
                console.error(`Error: ${error}`);
                console.log(`${"=".repeat(80)}\n`);
              }

              // Report failure to backend
              await connectorManager!.reportCommandResult(
                data.commandId,
                "failed",
                null,
                String(error),
              );

              if (verbose) {
                console.log(`[PINAI Command] Result reported to backend (status: failed)`);
              }
            }
          });

          // Listen for registration events
          connectorManager.on("registered", (registration) => {
            if (verbose) {
              ctx.logger.info("[PINAI Connector] Successfully connected to PINAI App!");
              ctx.logger.info(`  Connector ID: ${registration.connectorId}`);
              ctx.logger.info(`  Device: ${registration.deviceName}`);
              ctx.logger.info(`  Status: ${registration.status}`);
            }
          });

          connectorManager.on("token-expired", () => {
            if (verbose) {
              ctx.logger.warn("[PINAI Connector] QR code expired. Please restart to generate a new one.");
            }
          });

          connectorManager.on("error", (error) => {
            ctx.logger.error(`[PINAI Connector] Error: ${String(error)}`);
          });

          ctx.logger.info("[PINAI Connector] Service started");
        } catch (err) {
          ctx.logger.error(`[PINAI Connector] Failed to start: ${String(err)}`);
        }
      },

      async stop(ctx) {
        if (connectorManager) {
          await connectorManager.disconnect();
          connectorManager = null;
          ctx.logger.info("[PINAI Connector] Service stopped");
        }
      },
    });

    // Register CLI commands
    api.registerCli((ctx) => {
      ctx.program
        .command("pinai")
        .description("PINAI Connector commands")
        .addCommand(
          ctx.program
            .createCommand("connect")
            .description("Connect to PINAI mobile app via QR code")
            .action(async () => {
              try {
                // Check if already connected
                const { loadRegistration } = await import("./src/registration-store.js");
                const savedRegistration = loadRegistration();

                if (savedRegistration) {
                  console.log("\n✅ Already connected to PINAI App");
                  console.log(`   Connector ID: ${savedRegistration.connectorId}`);
                  console.log(`   Device: ${savedRegistration.deviceName}`);
                  console.log(`   Status: ${savedRegistration.status}\n`);
                  console.log("No need to scan QR code again. Connection is active.\n");
                  return;
                }

                // Call gateway method to generate QR code
                console.log("\n🔄 Connecting to gateway...\n");

                const { callGateway } = await import("../../src/gateway/call.js");

                try {
                  const result = await callGateway<{
                    success: boolean;
                    qrData: string;
                    token: string;
                    deviceId: string;
                    deviceName: string;
                    expiresIn: number;
                  }>({
                    method: "desktop-connector.generate-qr",
                    params: {},
                    timeoutMs: 10000,
                  });

                  if (!result.success) {
                    throw new Error("Failed to generate QR code");
                  }

                  console.log("=== Scan this QR code with PINAI App ===\n");
                  qrcode.generate(result.qrData, { small: true });
                  console.log("\nQR Code Details:");
                  console.log(`  Device: ${result.deviceName}`);
                  console.log(`  Device ID: ${result.deviceId}`);
                  console.log(`  Token: ${result.token.substring(0, 16)}...`);
                  console.log(`  Expires in: ${Math.floor(result.expiresIn / 1000)} seconds\n`);
                  console.log("✨ Gateway is now waiting for your scan...");
                  console.log("   After scanning, the connection will be established automatically.");
                  console.log("   No need to restart!\n");
                } catch (error) {
                  const errMsg = String(error);
                  if (errMsg.includes("ECONNREFUSED") || errMsg.includes("gateway closed")) {
                    console.error("\n❌ Error: Gateway is not running");
                    console.error("   Please start the gateway first:");
                    console.error("   openclaw gateway run\n");
                  } else if (errMsg.includes("NOT_INITIALIZED")) {
                    console.error("\n❌ Error: PINAI Connector plugin is not initialized");
                    console.error("   Please restart the gateway:");
                    console.error("   openclaw gateway restart\n");
                  } else {
                    console.error(`\n❌ Error: ${errMsg}\n`);
                  }
                  process.exit(1);
                }
              } catch (error) {
                console.error(`\n❌ Error: ${String(error)}\n`);
                process.exit(1);
              }
            }),
        )
        .addCommand(
          ctx.program
            .createCommand("status")
            .description("Show PINAI connector status")
            .action(async () => {
              try {
                const { loadRegistration } = await import("./src/registration-store.js");
                const savedRegistration = loadRegistration();

                if (savedRegistration) {
                  console.log("\n✅ PINAI Connector Status: Connected");
                  console.log(`   Connector ID: ${savedRegistration.connectorId}`);
                  console.log(`   Device: ${savedRegistration.deviceName}`);
                  console.log(`   Status: ${savedRegistration.status}`);
                  console.log(`   User ID: ${savedRegistration.userId || "N/A"}`);
                  console.log(`   Connected at: ${new Date(savedRegistration.createdAt).toLocaleString()}\n`);
                } else {
                  console.log("\n⚠️  PINAI Connector Status: Not connected");
                  console.log("   Run 'openclaw pinai show-qr' to connect.\n");
                }
              } catch (error) {
                console.error(`\n❌ Error: ${String(error)}\n`);
                process.exit(1);
              }
            }),
        );
    });

    // Register gateway methods
    api.registerGatewayMethod("desktop-connector.generate-qr", async ({ respond }) => {
      if (!connectorManager) {
        respond(false, undefined, { code: "NOT_INITIALIZED", message: "Connector not initialized" });
        return;
      }

      try {
        const hostname = os.hostname();
        const deviceName = `PINAI-Desktop-${hostname}`;
        const { qrData, token, deviceId } = await connectorManager.generateQRCode(deviceName);

        // Render QR code as PNG base64 (optional, requires additional implementation)
        respond(true, {
          success: true,
          qrData,
          token,
          deviceId,
          deviceName,
          expiresIn: 300000, // 5 minutes in ms
        });
      } catch (error) {
        respond(false, undefined, {
          code: "GENERATE_QR_ERROR",
          message: String(error),
        });
      }
    });

    api.registerGatewayMethod("desktop-connector.status", async ({ respond }) => {
      if (!connectorManager) {
        respond(false, undefined, { code: "NOT_INITIALIZED", message: "Connector not initialized" });
        return;
      }

      try {
        const status = connectorManager.getStatus();
        respond(true, {
          success: true,
          ...status,
        });
      } catch (error) {
        respond(false, undefined, {
          code: "STATUS_ERROR",
          message: String(error),
        });
      }
    });

    api.registerGatewayMethod("desktop-connector.disconnect", async ({ respond }) => {
      if (!connectorManager) {
        respond(false, undefined, { code: "NOT_INITIALIZED", message: "Connector not initialized" });
        return;
      }

      try {
        await connectorManager.disconnect();
        respond(true, {
          success: true,
          message: "Disconnected from PINAI backend",
        });
      } catch (error) {
        respond(false, undefined, {
          code: "DISCONNECT_ERROR",
          message: String(error),
        });
      }
    });
  },
};

export default pinaiConnectorPlugin;
