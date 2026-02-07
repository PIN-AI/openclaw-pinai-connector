/**
 * Work Context Collector
 * Collects user's memory summary for work context reporting
 */

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
  runtime: any; // PluginRuntime from api.runtime
  config: any; // OpenClawConfig from api.config
  agentSessionKey?: string;
};

/**
 * Collect work context by reading user's memory
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

  console.log("\n[Work Context] Collecting memory summary...");

  try {
    const { runtime, config, agentSessionKey } = deps;

    // Create memory search tool
    const memorySearchTool = runtime.tools.createMemorySearchTool({
      config,
      agentSessionKey,
    });

    if (!memorySearchTool) {
      console.log("[Work Context] Memory search tool not available");
      return {
        period: { startTime, endTime, durationHours: hoursBack },
        sessions: { total: 0, recentFiles: [] },
        activity: { tasksCompleted: [], filesModified: [], commandsRun: [], keyTopics: [] },
        summary: "Memory search not configured",
      };
    }

    // Search for recent work-related memories
    const queries = [
      "recent work tasks projects",
      "completed tasks achievements",
      "current goals objectives",
    ];

    const allResults: any[] = [];
    for (const query of queries) {
      try {
        const result = await memorySearchTool.execute("work-context-search", {
          query,
          maxResults: 5,
          minScore: 0.5,
        });

        if (result && typeof result === "object" && "results" in result) {
          const parsed = JSON.parse(result as any);
          if (parsed.results && Array.isArray(parsed.results)) {
            allResults.push(...parsed.results);
          }
        }
      } catch (err) {
        console.log(`[Work Context] Query "${query}" failed: ${err}`);
      }
    }

    // Build summary from memory results
    let summary = "";
    if (allResults.length > 0) {
      const uniqueResults = Array.from(
        new Map(allResults.map((r) => [r.path + r.from, r])).values(),
      );

      summary = uniqueResults
        .slice(0, 10)
        .map((r) => r.text || "")
        .filter((t) => t.length > 0)
        .join("\n\n")
        .substring(0, 1000); // Limit to 1000 chars

      console.log(`[Work Context] Collected ${uniqueResults.length} memory snippets`);
    }

    if (!summary || summary.length < 10) {
      summary = "No significant memory entries found for recent work context";
    }

    return {
      period: { startTime, endTime, durationHours: hoursBack },
      sessions: { total: 0, recentFiles: [] },
      activity: { tasksCompleted: [], filesModified: [], commandsRun: [], keyTopics: [] },
      summary,
    };
  } catch (error) {
    console.error(`[Work Context] Failed to collect memory: ${error}`);
    return {
      period: { startTime, endTime, durationHours: hoursBack },
      sessions: { total: 0, recentFiles: [] },
      activity: { tasksCompleted: [], filesModified: [], commandsRun: [], keyTopics: [] },
      summary: `Unable to collect memory: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
