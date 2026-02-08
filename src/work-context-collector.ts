/**
 * Work Context Collector
 * Collects user's memory summary for work context reporting by asking AI to summarize
 */

import crypto from "node:crypto";
import { loadCoreAgentDeps, resolveProviderModel } from "./core-bridge.js";

export type WorkContextSummary = {
  period: {
    startTime: number;
    endTime: number;
    durationHours: number;
  };
  sessions: {
    total: number;
    recentFiles: string[];
  };
  activity: {
    tasksCompleted: string[];
    filesModified: string[];
    commandsRun: string[];
    keyTopics: string[];
  };
  summary: string;
  summaryStatus?: "ok" | "no_data" | "error";
  summaryError?: string;
};

export type WorkContextDependencies = {
  config: any; // OpenClawConfig from api.config
  workspaceDir: string;
};

/**
 * Collect work context by asking AI to summarize from memory
 */
export async function collectWorkContext(
  hoursBack: number = 6,
  deps?: WorkContextDependencies,
): Promise<WorkContextSummary> {
  const endTime = Date.now();
  const startTime = endTime - hoursBack * 60 * 60 * 1000;

  if (!deps) {
    console.log("[Work Context] Dependencies not provided, returning placeholder");
    return {
      period: { startTime, endTime, durationHours: hoursBack },
      sessions: { total: 0, recentFiles: [] },
      activity: { tasksCompleted: [], filesModified: [], commandsRun: [], keyTopics: [] },
      summary: "Work context collection unavailable (dependencies not provided)",
      summaryStatus: "error",
      summaryError: "missing_dependencies",
    };
  }

  console.log("\n[Work Context] Asking AI to summarize recent work...");

  try {
    const { config } = deps;

    const coreDeps = await loadCoreAgentDeps();
    const agentId = coreDeps.DEFAULT_AGENT_ID;
    const sessionId = `work-context-${Date.now()}`;
    const workspaceDir =
      deps.workspaceDir?.trim() || coreDeps.resolveAgentWorkspaceDir(config, agentId);

    await coreDeps.ensureAgentWorkspace({ dir: workspaceDir });

    const sessionFile = coreDeps.resolveSessionTranscriptPath(sessionId, agentId);
    const agentDir = coreDeps.resolveAgentDir(config, agentId);

    // Ask AI to summarize work from memory
    const prompt = `Based on your memory, briefly summarize my work in the past ${hoursBack} hours, including completed tasks and current progress. If you have no relevant memory, reply exactly with "No work record". Respond in English within 200 words.`;

    const { provider, model } = resolveProviderModel(config, {
      provider: coreDeps.DEFAULT_PROVIDER,
      model: coreDeps.DEFAULT_MODEL,
    });

    const result = await coreDeps.runEmbeddedPiAgent({
      sessionId,
      sessionFile,
      workspaceDir,
      agentDir,
      config,
      prompt,
      provider,
      model,
      thinkLevel: "low",
      timeoutMs: 300000, // 5 minutes timeout
      runId: crypto.randomUUID(),
    });

    const payloads = result.payloads ?? [];
    const hasErrorPayload = payloads.some((p) => p.isError);
    const summary = payloads
      .map((p) => p.text || "")
      .filter((t) => t.length > 0)
      .join("\n")
      .trim();
    const summaryIsEmpty = !summary || summary.length < 5;
    let summaryStatus: WorkContextSummary["summaryStatus"] = "ok";
    let summaryError: string | undefined;
    let finalSummary = summary;

    if (result.meta?.aborted) {
      summaryStatus = "error";
      summaryError = "aborted";
    } else if (hasErrorPayload) {
      summaryStatus = "error";
      summaryError = "payload_error";
    } else if (summaryIsEmpty) {
      summaryStatus = "error";
      summaryError = "empty_summary";
      finalSummary = "AI failed to generate work summary";
    } else if (summary === "No work record") {
      summaryStatus = "no_data";
    }

    console.log(`[Work Context] AI summary generated (${finalSummary.length} chars)`);

    return {
      period: { startTime, endTime, durationHours: hoursBack },
      sessions: { total: 0, recentFiles: [] },
      activity: { tasksCompleted: [], filesModified: [], commandsRun: [], keyTopics: [] },
      summary: finalSummary,
      summaryStatus,
      summaryError,
    };
  } catch (error) {
    console.error(`[Work Context] Failed to generate AI summary: ${error}`);
    return {
      period: { startTime, endTime, durationHours: hoursBack },
      sessions: { total: 0, recentFiles: [] },
      activity: { tasksCompleted: [], filesModified: [], commandsRun: [], keyTopics: [] },
      summary: `Unable to generate work summary: ${error instanceof Error ? error.message : String(error)}`,
      summaryStatus: "error",
      summaryError: error instanceof Error ? error.message : String(error),
    };
  }
}
