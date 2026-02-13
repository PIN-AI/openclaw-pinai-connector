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
import { AgentHubChatManager } from "./src/chat/chat-manager.js";
import { AgentHubClient } from "./src/chat/agenthub-client.js";
import {
  loadAgentHubCredentials,
  saveAgentHubCredentials,
  updateChatEnabled,
} from "./src/chat/chat-store.js";
import { callGatewayMethod } from "./src/chat/gateway-client.js";
import { promptInput } from "./src/chat/prompt-helper.js";
import type { AgentHubCredentials, RegistrationPayload } from "./src/chat/types.js";

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

          // Set up work context dependencies for local snapshot collection
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
          await connectorManager.disconnect({
            clearRegistration: false,
            watchForRegistration: false,
            notifyRemote: false,
          });
          connectorManager = null;
          ctx.logger.info("[PINAI Connector] Service stopped");
        }
      },
    });

    // Register AgentHub Chat Service
    let chatManager: AgentHubChatManager | null = null;

    api.registerService({
      id: "pinai-chat",

      async start(ctx) {
        const credentials = loadAgentHubCredentials();

        if (!credentials) {
          ctx.logger.info("[PINAI Chat] Not registered. Run 'openclaw pinai chat register' to get started.");
          return;
        }

        if (!credentials.enabled) {
          ctx.logger.info("[PINAI Chat] Chat is disabled. Run 'openclaw pinai chat start' to enable.");
          return;
        }

        ctx.logger.info(`[PINAI Chat] Starting for agent: ${credentials.agentName}`);

        const chatConfig = {
          apiKey: credentials.apiKey,
          agentId: credentials.agentId,
          agentName: credentials.agentName,
          heartbeatIntervalMs: 60000,
          messagePollingIntervalMs: 15000,
          autoReply: true,
        };

        chatManager = new AgentHubChatManager(chatConfig);

        // Listen for new messages
        chatManager.on("message-received", async (message: any) => {
          if (verbose) {
            console.log(`\n${"=".repeat(80)}`);
            console.log(`[PINAI Chat] New message from ${message.peerName}`);
            console.log(`Message: ${message.content}`);
            console.log(`${"=".repeat(80)}\n`);
          }

          try {
            const coreDeps = await loadCoreAgentDeps();
            const agentId = coreDeps.DEFAULT_AGENT_ID;
            const sessionId = `pinai-chat-${message.peerId}`;
            const workspaceDir = ctx.workspaceDir || process.cwd();

            const prompt = `You received a message from agent "${message.peerName}" (ID: ${message.peerId}):

"${message.content}"

Please provide an appropriate response. Keep it concise and helpful.`;

            if (verbose) {
              console.log(`[PINAI Chat] Processing message with AI...`);
            }

            const { provider, model } = resolveProviderModel(ctx.config, {
              provider: coreDeps.DEFAULT_PROVIDER,
              model: coreDeps.DEFAULT_MODEL,
            });

            const result = await coreDeps.runEmbeddedPiAgent({
              sessionId,
              sessionFile: coreDeps.resolveSessionTranscriptPath(sessionId, agentId),
              workspaceDir,
              agentDir: coreDeps.resolveAgentDir(ctx.config, agentId),
              config: ctx.config,
              prompt,
              provider,
              model,
              thinkLevel: "low",
              timeoutMs: 60000,
              runId: crypto.randomUUID(),
            });

            // Extract response
            let response = "";
            if (result.payloads && result.payloads.length > 0) {
              response = result.payloads
                .map((p: any) => p.text || "")
                .filter((t: string) => t.length > 0)
                .join("\n")
                .trim();
            }

            if (response) {
              await chatManager!.sendMessage(message.peerId, response);
              if (verbose) {
                console.log(`[PINAI Chat] Sent reply to ${message.peerName}`);
              }
            }
          } catch (error) {
            console.error(`[PINAI Chat] Failed to process message: ${error}`);
          }
        });

        // Start the chat manager
        await chatManager.start();
        ctx.logger.info("[PINAI Chat] Service started and online");
      },

      async stop(ctx) {
        if (chatManager) {
          await chatManager.stop();
          chatManager = null;
          ctx.logger.info("[PINAI Chat] Service stopped");
        }
      },
    });

    // Register gateway methods for chat control
    api.registerGatewayMethod("pinai-chat.start", async ({ respond }) => {
      if (!chatManager) {
        respond(false, undefined, {
          code: "NOT_INITIALIZED",
          message: "Chat manager not initialized. Restart gateway or check registration.",
        });
        return;
      }

      try {
        await chatManager.start();
        respond(true, {
          success: true,
          message: "Chat service started",
          status: chatManager.getStatus(),
        });
      } catch (error) {
        respond(false, undefined, {
          code: "START_ERROR",
          message: String(error),
        });
      }
    });

    api.registerGatewayMethod("pinai-chat.stop", async ({ respond }) => {
      if (!chatManager) {
        respond(false, undefined, {
          code: "NOT_INITIALIZED",
          message: "Chat manager not initialized",
        });
        return;
      }

      try {
        await chatManager.stop();
        respond(true, {
          success: true,
          message: "Chat service stopped",
          status: chatManager.getStatus(),
        });
      } catch (error) {
        respond(false, undefined, {
          code: "STOP_ERROR",
          message: String(error),
        });
      }
    });

    api.registerGatewayMethod("pinai-chat.status", async ({ respond }) => {
      if (!chatManager) {
        respond(false, undefined, {
          code: "NOT_INITIALIZED",
          message: "Chat manager not initialized",
        });
        return;
      }

      try {
        const status = chatManager.getStatus();
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

                if (!workContext.context || workContext.context.trim().length < 5) {
                  console.log("\n⚠️  Work context snapshot is empty, aborting.\n");
                  return;
                }

                console.log("\n=== Work Context (preview) ===\n");
                console.log(workContext.context);
                console.log("\n=== End Work Context ===\n");

                const res = await fetch(`${config.backendUrl}/connector/pinai/work-context`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${savedRegistration.token}`,
                  },
                  body: JSON.stringify({
                    connector_id: savedRegistration.connectorId,
                    context: workContext.context,
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
        )
        .addCommand(
          ctx.program
            .createCommand("chat")
            .description("AgentHub chat commands")

            // register command
            .addCommand(
              ctx.program
                .createCommand("register")
                .description("Register as AgentHub agent")
                .option("--name <name>", "Agent name")
                .option("--role <role>", "Agent role: consumer, provider, or both", "consumer")
                .action(async (options: { name?: string; role?: string }) => {
                  try {
                    console.log("\n🚀 AgentHub Agent Registration");
                    console.log("=" .repeat(50));

                    const existingCreds = loadAgentHubCredentials();
                    if (existingCreds) {
                      console.log("\n⚠️  Already registered!");
                      console.log(`   Agent ID: ${existingCreds.agentId}`);
                      console.log(`   Agent Name: ${existingCreds.agentName}`);
                      console.log(`   Status: ${existingCreds.enabled ? "Enabled" : "Disabled"}`);
                      console.log("\n   Your agent is already set up.\n");
                      return;
                    }

                    console.log("\nThis will register your desktop as an agent on AgentHub.");
                    console.log("You'll be able to receive and send messages to other agents.\n");

                    // Step 1: Agent Name
                    const hostname = os.hostname();
                    const defaultName = `OpenClaw-Desktop-${hostname}`;
                    console.log("📝 Step 1: Agent Name");
                    console.log(`   This is how other agents will see you.`);
                    const agentName = options.name || (await promptInput(`   Enter name (press Enter for "${defaultName}"): `)) || defaultName;
                    console.log(`   ✓ Using: ${agentName}\n`);

                    // Step 2: Description
                    console.log("📝 Step 2: Description");
                    console.log(`   A brief description of your agent.`);
                    const defaultDesc = "Desktop AI agent powered by OpenClaw";
                    const description = (await promptInput(`   Enter description (press Enter for default): `)) || defaultDesc;
                    console.log(`   ✓ Using: ${description}\n`);

                    // Step 3: Role
                    console.log("📝 Step 3: Role");
                    console.log(`   • consumer: Can chat with other agents (recommended)`);
                    console.log(`   • provider: Provides services to other agents (requires endpoint)`);
                    console.log(`   • both: Can chat and provide services\n`);
                    const roleInput = options.role || (await promptInput(`   Enter role (consumer/provider/both, default: consumer): `)) || "consumer";
                    const role = roleInput.toLowerCase();

                    if (!["consumer", "provider", "both"].includes(role)) {
                      console.log(`\n❌ Invalid role: ${role}`);
                      console.log("   Must be: consumer, provider, or both\n");
                      return;
                    }
                    console.log(`   ✓ Using: ${role}\n`);

                    let endpoint = "";
                    let tags: string[] = [];

                    if (role === "provider" || role === "both") {
                      console.log("📝 Step 4: Provider Configuration");
                      console.log("   Provider/both roles require an HTTP endpoint.");
                      console.log("   This is where other agents will send requests.\n");

                      endpoint = await promptInput("   Endpoint URL (e.g., https://your-domain.com/api/skill): ");

                      if (!endpoint) {
                        console.log("\n❌ Endpoint is required for provider/both roles.");
                        console.log("   Tip: Use role 'consumer' if you only want chat functionality.\n");
                        return;
                      }
                      console.log(`   ✓ Endpoint: ${endpoint}\n`);

                      // Fetch tags (optional, with error handling)
                      console.log("📋 Fetching available tags...");
                      try {
                        const availableTags = await AgentHubClient.getTags();
                        console.log(`   Available: ${availableTags.slice(0, 10).join(", ")}${availableTags.length > 10 ? "..." : ""}\n`);

                        console.log("   Select up to 3 tags (comma-separated, or press Enter to skip):");
                        const tagsInput = await promptInput("   Tags: ");
                        if (tagsInput.trim()) {
                          tags = tagsInput.split(",").map((t) => t.trim()).filter((t) => t.length > 0).slice(0, 3);
                          console.log(`   ✓ Selected: ${tags.join(", ")}\n`);
                        } else {
                          console.log(`   ✓ No tags selected\n`);
                        }
                      } catch (error) {
                        console.log(`   ⚠️  Could not fetch tags (network error)`);
                        console.log(`   Continuing without tags...\n`);
                      }
                    }

                    console.log("🔄 Registering with AgentHub...\n");

                    const registrationPayload: RegistrationPayload = {
                      name: agentName,
                      description,
                      role: role as "consumer" | "provider" | "both",
                      entity_type: "agent",
                    };

                    if (role === "provider" || role === "both") {
                      registrationPayload.endpoint = endpoint;
                      if (tags.length > 0) {
                        registrationPayload.tags = tags;
                      }
                      registrationPayload.skills = [];
                    }

                    const result = await AgentHubClient.register(registrationPayload);

                    const credentials: AgentHubCredentials = {
                      apiKey: result.api_key,
                      agentId: result.agent_id,
                      agentName,
                      role: role as "consumer" | "provider" | "both",
                      endpoint: endpoint || undefined,
                      registeredAt: Date.now(),
                      enabled: true,
                    };

                    saveAgentHubCredentials(credentials);

                    console.log("=" .repeat(50));
                    console.log("✅ Registration Successful!");
                    console.log("=" .repeat(50));
                    console.log("\n📋 Agent Details:");
                    console.log(`   Agent ID: ${result.agent_id}`);
                    console.log(`   Agent Name: ${agentName}`);
                    console.log(`   Role: ${role}`);
                    if (endpoint) {
                      console.log(`   Endpoint: ${endpoint}`);
                    }
                    console.log(`\n💾 Credentials saved to:`);
                    console.log(`   ~/.openclaw/pinai-agenthub-credentials.json`);
                    console.log(`   ⚠️  Keep this file secure!\n`);

                    console.log("💓 Sending initial heartbeat...");
                    try {
                      const client = new AgentHubClient(result.api_key);
                      await client.sendHeartbeat(true);
                      console.log("✅ Agent is now online!\n");
                    } catch (error) {
                      console.log("⚠️  Heartbeat failed (will retry automatically)\n");
                    }

                    console.log("🚀 Next Steps:");
                    console.log("   1. Restart gateway: openclaw gateway restart");
                    console.log("   2. Check status: openclaw pinai chat status");
                    console.log("   3. Start chatting: openclaw pinai chat list\n");
                    console.log("💡 The 'chat-agent' skill is now available:");
                    console.log("   • AI can find agents with specific expertise");
                    console.log("   • AI can chat with other agents for collaboration");
                    console.log("   • Incoming messages are handled automatically\n");
                  } catch (error) {
                    console.log("\n" + "=".repeat(50));
                    console.error("❌ Registration Failed");
                    console.log("=".repeat(50));

                    if (error instanceof Error) {
                      if (error.message.includes("fetch failed") || error.message.includes("ENOTFOUND")) {
                        console.log("\n⚠️  Network Error:");
                        console.log("   Cannot connect to agents.pinai.tech");
                        console.log("\n💡 Troubleshooting:");
                        console.log("   • Check your internet connection");
                        console.log("   • Verify you can access https://agents.pinai.tech");
                        console.log("   • Check if a firewall is blocking the connection");
                        console.log("   • Try again in a few moments\n");
                      } else {
                        console.log(`\n   Error: ${error.message}\n`);
                      }
                    } else {
                      console.log(`\n   Error: ${String(error)}\n`);
                    }
                    process.exit(1);
                  }
                })
            )

            // start command
            .addCommand(
              ctx.program
                .createCommand("start")
                .description("Enable chat permanently")
                .action(async () => {
                  try {
                    const credentials = loadAgentHubCredentials();
                    if (!credentials) {
                      console.log("\n⚠️  Not registered. Run 'openclaw pinai chat register' first.\n");
                      return;
                    }

                    if (credentials.enabled) {
                      console.log("\n⚠️  Chat is already enabled.\n");
                      console.log("💡 If the service is not running, restart the gateway:");
                      console.log("   openclaw gateway restart\n");
                      return;
                    }

                    console.log("\n🚀 Enabling chat...\n");

                    updateChatEnabled(true);

                    console.log("✅ Chat enabled!");
                    console.log(`   Agent: ${credentials.agentName}`);
                    console.log("\n🔄 Restart gateway to start the service:");
                    console.log("   openclaw gateway restart\n");
                  } catch (error) {
                    console.error(`\n❌ Error: ${error}\n`);
                    process.exit(1);
                  }
                })
            )

            // stop command
            .addCommand(
              ctx.program
                .createCommand("stop")
                .description("Disable chat permanently")
                .action(async () => {
                  try {
                    const credentials = loadAgentHubCredentials();
                    if (!credentials) {
                      console.log("\n⚠️  Not registered.\n");
                      return;
                    }

                    if (!credentials.enabled) {
                      console.log("\n⚠️  Chat is already disabled.\n");
                      return;
                    }

                    console.log("\n🛑 Disabling chat...\n");

                    updateChatEnabled(false);

                    console.log("✅ Chat disabled!");
                    console.log("   Agent will go offline on next gateway restart.\n");
                    console.log("🔄 Restart gateway to apply:");
                    console.log("   openclaw gateway restart\n");
                    console.log("💡 To re-enable: openclaw pinai chat start\n");
                  } catch (error) {
                    console.error(`\n❌ Error: ${error}\n`);
                    process.exit(1);
                  }
                })
            )

            // status command
            .addCommand(
              ctx.program
                .createCommand("status")
                .description("Show chat status")
                .action(async () => {
                  try {
                    const credentials = loadAgentHubCredentials();
                    if (!credentials) {
                      console.log("\n⚠️  Not registered. Run 'openclaw pinai chat register' first.\n");
                      return;
                    }

                    console.log("\n📊 AgentHub Chat Status\n");
                    console.log(`   Agent ID: ${credentials.agentId}`);
                    console.log(`   Agent Name: ${credentials.agentName}`);
                    console.log(`   Role: ${credentials.role}`);
                    console.log(`   Chat: ${credentials.enabled ? "🟢 Enabled" : "🔴 Disabled"}`);

                    if (credentials.enabled) {
                      // Check online status via AgentHub API
                      try {
                        const client = new AgentHubClient(credentials.apiKey);
                        const response = await client.sendHeartbeat(true);

                        console.log(`   Online Status: 🟢 Online`);
                        if (response.unread_count !== undefined) {
                          console.log(`   Unread Messages: ${response.unread_count}`);
                        }
                        if (credentials.lastHeartbeat) {
                          console.log(`   Last Heartbeat: ${new Date(credentials.lastHeartbeat).toLocaleString()}`);
                        }

                        console.log("\n💡 Service is running in gateway.");
                        console.log("   Check logs: tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | grep Chat");
                      } catch (error) {
                        console.log(`   Online Status: ⚠️  Cannot connect to AgentHub`);
                        console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
                      }
                    } else {
                      console.log("\n💡 Chat is disabled. Run 'openclaw pinai chat start' to enable.");
                    }

                    console.log();
                  } catch (error) {
                    console.error(`\n❌ Error: ${error}\n`);
                    process.exit(1);
                  }
                })
            )

            // list command
            .addCommand(
              ctx.program
                .createCommand("list")
                .description("List all conversations")
                .action(async () => {
                  try {
                    const credentials = loadAgentHubCredentials();
                    if (!credentials) {
                      console.log("\n⚠️  Not registered.\n");
                      return;
                    }

                    const client = new AgentHubClient(credentials.apiKey);
                    const conversations = await client.getConversations();

                    console.log("\n💬 Conversations\n");
                    if (conversations.length === 0) {
                      console.log("   No conversations yet.\n");
                      return;
                    }

                    for (const conv of conversations) {
                      const unread = conv.unread_count > 0 ? `(${conv.unread_count} unread)` : "";
                      console.log(`   ${conv.peer.name} [${conv.peer.id}] ${unread}`);
                      if (conv.last_message) {
                        const preview = conv.last_message.content.length > 60
                          ? conv.last_message.content.substring(0, 60) + "..."
                          : conv.last_message.content;
                        console.log(`   └─ ${preview}`);
                      }
                      console.log();
                    }
                  } catch (error) {
                    console.error(`\n❌ Error: ${error}\n`);
                    process.exit(1);
                  }
                })
            )

            // read command
            .addCommand(
              ctx.program
                .createCommand("read")
                .description("Read messages from a peer")
                .argument("<agent_id>", "Agent ID to read messages from")
                .option("-n, --limit <number>", "Number of messages to show", "20")
                .action(async (agentId: string, options: { limit: string }) => {
                  try {
                    const credentials = loadAgentHubCredentials();
                    if (!credentials) {
                      console.log("\n⚠️  Not registered.\n");
                      return;
                    }

                    const client = new AgentHubClient(credentials.apiKey);
                    const messages = await client.getMessages(agentId, parseInt(options.limit));

                    console.log(`\n💬 Messages with ${agentId}\n`);

                    if (messages.length === 0) {
                      console.log("   No messages yet.\n");
                      return;
                    }

                    for (const msg of messages) {
                      const from = msg.from === credentials.agentId ? "You" : agentId;
                      const time = new Date(msg.created_at).toLocaleString();
                      console.log(`[${time}] ${from}:`);
                      console.log(`  ${msg.content}\n`);
                    }
                  } catch (error) {
                    console.error(`\n❌ Error: ${error}\n`);
                    process.exit(1);
                  }
                })
            )

            // send command
            .addCommand(
              ctx.program
                .createCommand("send")
                .description("Send a message to an agent")
                .argument("<agent_id>", "Target agent ID")
                .argument("[message...]", "Message content")
                .action(async (agentId: string, messageParts: string[]) => {
                  try {
                    const credentials = loadAgentHubCredentials();
                    if (!credentials) {
                      console.log("\n⚠️  Not registered.\n");
                      return;
                    }

                    const client = new AgentHubClient(credentials.apiKey);

                    let message: string;
                    if (messageParts.length > 0) {
                      message = messageParts.join(" ");
                    } else {
                      message = await promptInput("Message: ");
                    }

                    if (!message) {
                      console.log("\n⚠️  Message cannot be empty.\n");
                      return;
                    }

                    const result = await client.sendMessage(agentId, message);

                    console.log("\n✅ Message sent!");
                    console.log(`   Target supports chat: ${result.target_supports_chat ? "Yes" : "No"}`);
                    console.log(`   Delivery hint: ${result.delivery_hint}\n`);
                  } catch (error) {
                    console.error(`\n❌ Error: ${error}\n`);
                    process.exit(1);
                  }
                })
            )

            // discover command
            .addCommand(
              ctx.program
                .createCommand("discover")
                .description("Search and discover agents on AgentHub")
                .option("--role <role>", "Filter by role: consumer, provider, or both")
                .option("--tags <tags>", "Filter by tags (comma-separated)")
                .option("--limit <number>", "Maximum number of results", "20")
                .action(async (options: { role?: string; tags?: string; limit: string }) => {
                  try {
                    const credentials = loadAgentHubCredentials();
                    if (!credentials) {
                      console.log("\n⚠️  Not registered.\n");
                      return;
                    }

                    const client = new AgentHubClient(credentials.apiKey);

                    const searchOptions: any = {
                      limit: parseInt(options.limit),
                    };

                    if (options.role) {
                      searchOptions.role = options.role;
                    }

                    if (options.tags) {
                      searchOptions.tags = options.tags.split(",").map((t) => t.trim());
                    }

                    const agents = await client.searchAgents(searchOptions);

                    console.log("\n🔍 AgentHub Agents\n");

                    if (agents.length === 0) {
                      console.log("   No agents found matching your criteria.\n");
                      return;
                    }

                    for (let i = 0; i < agents.length; i++) {
                      const agent = agents[i];
                      console.log(`   ${i + 1}. ${agent.name} [${agent.agent_id}]`);
                      console.log(`      Role: ${agent.role}`);
                      if (agent.description) {
                        console.log(`      Description: ${agent.description}`);
                      }
                      if (agent.tags && agent.tags.length > 0) {
                        console.log(`      Tags: ${agent.tags.join(", ")}`);
                      }
                      console.log(`      Status: ${agent.online ? "🟢 Online" : "⚪ Offline"}`);
                      console.log();
                    }

                    console.log(`   Found ${agents.length} agent(s)\n`);
                  } catch (error) {
                    console.error(`\n❌ Error: ${error}\n`);
                    process.exit(1);
                  }
                })
            )
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
