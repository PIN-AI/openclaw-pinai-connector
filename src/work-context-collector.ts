/**
 * Work Context Collector
 *
 * NOTE: Work context collection is disabled for standalone plugins because
 * the required OpenClaw core APIs (runEmbeddedPiAgent) are not exposed
 * in the plugin runtime.
 *
 * This is a limitation of the plugin system architecture - plugins run
 * in isolation and cannot access internal OpenClaw agent APIs.
 */

import crypto from "node:crypto";

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

/**
 * Collect work context (disabled in plugin mode)
 * Returns a minimal placeholder summary
 */
export async function collectWorkContext(hoursBack: number = 6): Promise<WorkContextSummary> {
  const endTime = Date.now();
  const startTime = endTime - hoursBack * 60 * 60 * 1000;

  return {
    period: {
      startTime,
      endTime,
      durationHours: hoursBack,
    },
    sessions: {
      total: 0,
      recentFiles: [],
    },
    activity: {
      tasksCompleted: [],
      filesModified: [],
      commandsRun: [],
      keyTopics: [],
    },
    summary: "Work context collection is not available in plugin mode",
  };
}
