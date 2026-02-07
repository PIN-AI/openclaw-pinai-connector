/**
 * Work Context Collector
 * Uses OpenClaw's AI to summarize recent work activity
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

export type WorkContextDependencies = {
  config: any;
  agentDir: string;
  workspaceDir: string;
  runEmbeddedPiAgent: any;
  resolveSessionTranscriptPath: any;
  DEFAULT_AGENT_ID: string;
  DEFAULT_MODEL: string;
  DEFAULT_PROVIDER: string;
};

/**
 * Collect work context by asking OpenClaw AI to summarize recent work
 */
export async function collectWorkContext(
  hoursBack: number = 6,
  deps?: WorkContextDependencies,
): Promise<WorkContextSummary> {
  const endTime = Date.now();
  const startTime = endTime - hoursBack * 60 * 60 * 1000;

  if (!deps) {
    console.log(
      `\n[Work Context] Dependencies not provided, returning minimal summary`,
    );
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
      summary: "Work context collection unavailable (dependencies not provided)",
    };
  }

  console.log(
    `\n[Work Context] Asking OpenClaw AI to summarize work from the last ${hoursBack} hours...`,
  );

  try {
    const { config, agentDir, workspaceDir, runEmbeddedPiAgent, resolveSessionTranscriptPath, DEFAULT_AGENT_ID, DEFAULT_MODEL, DEFAULT_PROVIDER } = deps;

    // Create a temporary session for this query
    const sessionId = `work-context-${Date.now()}`;
    const sessionFile = resolveSessionTranscriptPath(sessionId, DEFAULT_AGENT_ID);

    // Build the prompt
    const prompt = `Summarize my recent work activities.

Include:
- Main tasks or projects
- Key files modified
- Important commands or operations
- Overall progress

Requirements:
- 200-300 words, plain text
- Start directly with the summary content
- No preamble, meta-commentary, or phrases like "Based on..." or "Here's..."`;

    // Call OpenClaw AI directly
    const result = await runEmbeddedPiAgent({
      sessionId,
      sessionFile,
      workspaceDir,
      agentDir,
      config,
      prompt,
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      thinkLevel: "low",
      timeoutMs: 60000,
      runId: crypto.randomUUID(),
    });

    // Extract the AI's response from payloads
    let summary = "";
    if (result.payloads && result.payloads.length > 0) {
      // Concatenate all text from payloads
      summary = result.payloads
        .map((p: any) => p.text || "")
        .filter((t: string) => t.length > 0)
        .join("\n")
        .trim();
    }

    if (!summary || summary.length < 10) {
      summary = "No significant activity detected in the last 6 hours.";
    }

    console.log(`[Work Context] AI Summary generated (${summary.length} chars)`);

    // Return structured data with AI-generated summary
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
      summary,
    };
  } catch (error) {
    console.error(`[Work Context] Failed to get AI summary: ${error}`);

    // Fallback to simple message
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
      summary: `Unable to generate work summary: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
