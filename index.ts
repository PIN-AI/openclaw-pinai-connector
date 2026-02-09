/**
 * PINAI Connector Plugin
 * Desktop connector for PINAI mobile app integration
 */

import os from "node:os";
import crypto from "node:crypto";
import qrcode from "qrcode-terminal";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { DesktopConnectorManager } from "./src/connector-manager.js";
import { loadCoreAgentDeps, resolveProviderModel } from "./src/core-bridge.js";
import { collectWorkContext } from "./src/work-context-collector.js";
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

          // Set up work context dependencies for AI-based work summary
          connectorManager.setWorkContextDependencies({
            config: api.config,
            workspaceDir: ctx.workspaceDir || process.cwd(),
          });

          if (verbose) {
            ctx.logger.info("[PINAI Connector] Work context dependencies configured");
          }

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
              const coreDeps = await loadCoreAgentDeps();
              const agentId = coreDeps.DEFAULT_AGENT_ID;
              const sessionId = `pinai-command-${data.commandId}`;
              const workspaceDir =
                ctx.workspaceDir?.trim() || coreDeps.resolveAgentWorkspaceDir(ctx.config, agentId);

              await coreDeps.ensureAgentWorkspace({ dir: workspaceDir });

              const sessionFile = coreDeps.resolveSessionTranscriptPath(sessionId, agentId);
              const agentDir = coreDeps.resolveAgentDir(ctx.config, agentId);

              if (verbose) {
                console.log(`[PINAI Command] Executing with OpenClaw AI...`);
              }

              const { provider, model } = resolveProviderModel(ctx.config, {
                provider: coreDeps.DEFAULT_PROVIDER,
                model: coreDeps.DEFAULT_MODEL,
              });

              const result = await coreDeps.runEmbeddedPiAgent({
                sessionId,
                sessionFile,
                workspaceDir,
                agentDir,
                config: ctx.config,
                prompt: data.prompt,
                provider,
                model,
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
          await connectorManager.disconnect({ clearRegistration: false, watchForRegistration: false });
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
                // Check if connector is already registered
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

                // Generate new QR code
                console.log("\n🔄 Generating QR code...\n");

                const hostname = os.hostname();
                const deviceName = `PINAI-Desktop-${hostname}`;
                const { getDeviceId } = await import("./src/device-id.js");
                const deviceId = getDeviceId();

                const url = `${config.backendUrl}/connector/pinai/qr-token`;
                const res = await fetch(url, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    device_name: deviceName,
                    device_type: "desktop",
                    device_id: deviceId,
                  }),
                });

                if (!res.ok) {
                  throw new Error(`Failed to generate QR code: ${res.status} ${res.statusText}`);
                }

                const data = (await res.json()) as {
                  token: string;
                  qr_data: string;
                  expires_in: number;
                };

                const qrData = data.qr_data.includes("?")
                  ? `${data.qr_data}&deviceId=${encodeURIComponent(deviceId)}`
                  : `${data.qr_data}?deviceId=${encodeURIComponent(deviceId)}`;

                console.log("=== Scan this QR code with PINAI App ===\n");
                qrcode.generate(qrData, { small: true });
                console.log("\nQR Code Details:");
                console.log(`  Device: ${deviceName}`);
                console.log(`  Device ID: ${deviceId}`);
                console.log(`  Token: ${data.token.substring(0, 16)}...`);
                console.log(`  Expires in: ${data.expires_in} seconds\n`);
                console.log("⏳ Waiting for you to scan the QR code...\n");

                // Poll for registration status
                const maxAttempts = 60; // 5 minutes (60 * 5 seconds)
                let attempts = 0;
                let registered = false;

                while (attempts < maxAttempts && !registered) {
                  attempts++;

                  try {
                    const checkUrl = `${config.backendUrl}/connector/pinai/check-login-status?token=${encodeURIComponent(data.token)}`;
                    const checkRes = await fetch(checkUrl);

                    if (checkRes.ok) {
                      const checkData = (await checkRes.json()) as {
                        registered?: boolean;
                        status?: string;
                        connector_id?: string;
                        user_id?: string;
                        device_name?: string;
                        expired?: boolean;
                      };

                      // Check both possible formats
                      const isRegistered = checkData.registered === true || checkData.status === "registered";

                      if (isRegistered && checkData.connector_id) {
                        // Registration successful! Save it
                        const { saveRegistration } = await import("./src/registration-store.js");

                        const registration = {
                          connectorId: checkData.connector_id,
                          deviceName,
                          deviceType: "desktop" as const,
                          token: data.token,
                          userId: checkData.user_id || "",
                          status: "connected" as const,
                          registeredAt: Date.now(),
                          lastWorkContextReportTime: 0,
                        };

                        saveRegistration(registration);

                        console.log("\n✅ Successfully connected to PINAI App!");
                        console.log(`   Connector ID: ${registration.connectorId}`);
                        console.log(`   User ID: ${registration.userId}`);
                        console.log(`   Device: ${deviceName}\n`);
                        console.log("✅ Connection saved.");
                        console.log("   If the gateway is running, it should activate within a few seconds.");
                        console.log("   If not, start or restart the gateway:");
                        console.log("   openclaw gateway restart\n");

                        registered = true;
                        break;
                      }
                    }
                  } catch (pollError) {
                    // Ignore polling errors, continue trying
                  }

                  // Wait 5 seconds before next poll
                  await new Promise(resolve => setTimeout(resolve, 5000));
                }

                if (!registered) {
                  console.log("\n⏱️  QR code expired or scan timeout.");
                  console.log("   Please run 'openclaw pinai connect' again to generate a new QR code.\n");
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
                  console.log("   Run 'openclaw pinai connect' to connect.\n");
                }
              } catch (error) {
                console.error(`\n❌ Error: ${String(error)}\n`);
                process.exit(1);
              }
            }),
        )
        .addCommand(
          ctx.program
            .createCommand("disconnect")
            .description("Disconnect and delete PINAI connector registration")
            .action(async () => {
              try {
                const { loadRegistration, clearRegistration } = await import(
                  "./src/registration-store.js"
                );
                const savedRegistration = loadRegistration();

                if (!savedRegistration) {
                  console.log("\n⚠️  PINAI Connector: Not connected");
                  console.log("   Run 'openclaw pinai connect' to connect.\n");
                  return;
                }

                const res = await fetch(`${config.backendUrl}/connector/pinai/disconnect`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${savedRegistration.token}`,
                  },
                  body: JSON.stringify({
                    connector_id: savedRegistration.connectorId,
                    delete: true,
                  }),
                });

                if (!res.ok) {
                  const text = await res.text();
                  throw new Error(`Failed to disconnect: ${res.status} ${text}`);
                }

                clearRegistration();

                console.log("\n✅ PINAI Connector disconnected and removed");
                console.log("   If the gateway is running, restart it to stop the connector.\n");
              } catch (error) {
                console.error(`\n❌ Error: ${String(error)}\n`);
                process.exit(1);
              }
            }),
        )
        .addCommand(
          ctx.program
            .createCommand("work-context")
            .description("Collect and report work context immediately")
            .option("--hours <hours>", "Limit to last N hours (0 = full)", "0")
            .action(async (options: { hours?: string }) => {
              try {
                const { loadRegistration, saveRegistration } = await import(
                  "./src/registration-store.js"
                );
                const savedRegistration = loadRegistration();

                if (!savedRegistration) {
                  console.log("\n⚠️  PINAI Connector: Not connected");
                  console.log("   Run 'openclaw pinai connect' to connect.\n");
                  return;
                }

                const hours = options?.hours ? Number.parseFloat(options.hours) : 0;
                const hoursBack = Number.isFinite(hours) ? hours : 0;

                console.log("\n[Work Context] Collecting snapshot...");
                const workContext = await collectWorkContext(
                  hoursBack,
                  {
                    config: ctx.config,
                    workspaceDir: ctx.workspaceDir || process.cwd(),
                  },
                  savedRegistration.lastWorkContextReportTime || undefined,
                );

                if (!workContext.summary || workContext.summary.trim().length < 5) {
                  console.log("\n⚠️  Work context summary is empty, aborting.\n");
                  return;
                }

                console.log("\n=== Work Context (preview) ===\n");
                console.log(workContext.summary);
                console.log("\n=== End Work Context ===\n");

                const res = await fetch(`${config.backendUrl}/connector/pinai/work-context`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${savedRegistration.token}`,
                  },
                  body: JSON.stringify({
                    connector_id: savedRegistration.connectorId,
                    summary: workContext.summary,
                    reported_at: Date.now(),
                  }),
                });

                if (!res.ok) {
                  const text = await res.text();
                  throw new Error(`Failed to report work context: ${res.status} ${text}`);
                }

                savedRegistration.lastWorkContextReportTime = Date.now();
                saveRegistration(savedRegistration);

                console.log("\n✅ Work context reported successfully\n");
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
