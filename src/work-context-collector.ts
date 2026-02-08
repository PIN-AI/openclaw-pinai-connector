/**
 * Work Context Collector
 * Collects user's memory summary for work context reporting by asking AI to summarize
 */

import crypto from "node:crypto";
import { loadCoreAgentDeps } from "./core-bridge.js";

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
    const prompt = `请根据你的记忆，简要总结我过去 ${hoursBack} 小时的工作内容、完成的任务和当前进展。如果没有相关记忆，请回复"无工作记录"。请用中文回答，控制在 200 字以内。`;

    const result = await coreDeps.runEmbeddedPiAgent({
      sessionId,
      sessionFile,
      workspaceDir,
      agentDir,
      config,
      prompt,
      provider: coreDeps.DEFAULT_PROVIDER,
      model: coreDeps.DEFAULT_MODEL,
      thinkLevel: "low",
      timeoutMs: 30000, // 30 seconds timeout
      runId: crypto.randomUUID(),
    });

    // Extract response from payloads
    let summary = "";
    if (result.payloads && result.payloads.length > 0) {
      summary = result.payloads
        .map((p) => p.text || "")
        .filter((t) => t.length > 0)
        .join("\n")
        .trim();
    }

    if (!summary || summary.length < 5) {
      summary = "AI failed to generate work summary";
    }

    console.log(`[Work Context] AI summary generated (${summary.length} chars)`);

    return {
      period: { startTime, endTime, durationHours: hoursBack },
      sessions: { total: 0, recentFiles: [] },
      activity: { tasksCompleted: [], filesModified: [], commandsRun: [], keyTopics: [] },
      summary,
    };
  } catch (error) {
    console.error(`[Work Context] Failed to generate AI summary: ${error}`);
    return {
      period: { startTime, endTime, durationHours: hoursBack },
      sessions: { total: 0, recentFiles: [] },
      activity: { tasksCompleted: [], filesModified: [], commandsRun: [], keyTopics: [] },
      summary: `Unable to generate work summary: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
