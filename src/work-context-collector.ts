/**
 * Work Context Collector
 * Collects local work context snapshot and optionally asks AI to summarize
 */

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

type FileEntry = {
  path: string;
  size: number;
  mtimeMs: number;
};

type SessionEntry = {
  file: string;
  size: number;
  mtimeMs: number;
};

type LocalContext = {
  roots: string[];
  fileStats: {
    totalFiles: number;
    totalBytes: number;
    truncated: boolean;
    oldestMtimeMs?: number;
    newestMtimeMs?: number;
    recentFiles: FileEntry[];
    largestFiles: FileEntry[];
    extensionCounts: Record<string, number>;
  };
  sessions: {
    total: number;
    recent: SessionEntry[];
    truncated: boolean;
    oldestMtimeMs?: number;
    newestMtimeMs?: number;
  };
  git?: {
    root?: string;
    head?: string;
    changesSince?: {
      sinceMs?: number;
      committed: string[];
      uncommitted: string[];
      truncated: boolean;
    };
  };
};

const MAX_SCAN_FILES = 20000;
const MAX_RECENT_FILES = 200;
const MAX_LARGEST_FILES = 50;
const MAX_SESSION_FILES = 50;
const MAX_CONTEXT_CHARS = 8000;
const MAX_GIT_FILES = 200;

const DEFAULT_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  ".idea",
  ".vscode",
  ".venv",
  "venv",
  "__pycache__",
  "coverage",
  "target",
  "out",
]);

function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxChars - 24))}...(truncated)`;
}

function normalizeExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext || "(no_ext)";
}

function updateTopList(
  list: FileEntry[],
  entry: FileEntry,
  limit: number,
  sortKey: "mtimeMs" | "size",
): FileEntry[] {
  list.push(entry);
  list.sort((a, b) => b[sortKey] - a[sortKey]);
  if (list.length > limit) {
    list.length = limit;
  }
  return list;
}

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string } | null> {
  return await new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

function normalizeGitPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.includes("->")) {
    const parts = trimmed.split("->").map((p) => p.trim());
    return parts[parts.length - 1] || trimmed;
  }
  return trimmed;
}

async function collectGitChanges(
  workspaceDir: string,
  sinceMs?: number,
): Promise<LocalContext["git"]> {
  const rootResult = await runGit(["rev-parse", "--show-toplevel"], workspaceDir);
  if (!rootResult) {
    return {};
  }
  const root = rootResult.stdout.trim();
  const headResult = await runGit(["rev-parse", "HEAD"], workspaceDir);
  const head = headResult?.stdout.trim();

  const committed: string[] = [];
  let truncated = false;

  if (sinceMs && sinceMs > 0) {
    const sinceIso = new Date(sinceMs).toISOString();
    const logResult = await runGit(
      ["log", "--name-only", "--since", sinceIso, "--pretty=format:"],
      workspaceDir,
    );
    if (logResult?.stdout) {
      const seen = new Set<string>();
      for (const line of logResult.stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        const normalized = normalizeGitPath(trimmed);
        if (!normalized || seen.has(normalized)) {
          continue;
        }
        seen.add(normalized);
        committed.push(normalized);
        if (committed.length >= MAX_GIT_FILES) {
          truncated = true;
          break;
        }
      }
    }
  }

  const uncommitted: string[] = [];
  const statusResult = await runGit(["status", "--porcelain"], workspaceDir);
  if (statusResult?.stdout) {
    const seen = new Set<string>();
    for (const line of statusResult.stdout.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const filePart = line.slice(3);
      const normalized = normalizeGitPath(filePart);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      uncommitted.push(normalized);
      if (uncommitted.length >= MAX_GIT_FILES) {
        truncated = true;
        break;
      }
    }
  }

  return {
    root,
    head,
    changesSince: {
      sinceMs,
      committed,
      uncommitted,
      truncated,
    },
  };
}

async function walkFiles(root: string): Promise<LocalContext["fileStats"]> {
  const stats: LocalContext["fileStats"] = {
    totalFiles: 0,
    totalBytes: 0,
    truncated: false,
    recentFiles: [],
    largestFiles: [],
    extensionCounts: {},
  };

  const queue: string[] = [root];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (stats.totalFiles >= MAX_SCAN_FILES) {
        stats.truncated = true;
        return stats;
      }

      if (entry.isDirectory()) {
        if (DEFAULT_SKIP_DIRS.has(entry.name)) {
          continue;
        }
        if (entry.name.startsWith(".")) {
          continue;
        }
        queue.push(path.join(current, entry.name));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      let fileStat;
      try {
        fileStat = await fs.stat(fullPath);
      } catch {
        continue;
      }

      const relativePath = path.relative(root, fullPath) || entry.name;
      const entryData: FileEntry = {
        path: relativePath,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
      };

      stats.totalFiles += 1;
      stats.totalBytes += fileStat.size;
      stats.recentFiles = updateTopList(stats.recentFiles, entryData, MAX_RECENT_FILES, "mtimeMs");
      stats.largestFiles = updateTopList(stats.largestFiles, entryData, MAX_LARGEST_FILES, "size");

      const ext = normalizeExt(entry.name);
      stats.extensionCounts[ext] = (stats.extensionCounts[ext] ?? 0) + 1;

      const mtime = fileStat.mtimeMs;
      if (stats.oldestMtimeMs === undefined || mtime < stats.oldestMtimeMs) {
        stats.oldestMtimeMs = mtime;
      }
      if (stats.newestMtimeMs === undefined || mtime > stats.newestMtimeMs) {
        stats.newestMtimeMs = mtime;
      }
    }
  }

  return stats;
}

async function collectSessionStats(agentId: string): Promise<LocalContext["sessions"]> {
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw");
  const sessionsDir = path.join(stateDir, "agents", agentId, "sessions");
  const result: LocalContext["sessions"] = {
    total: 0,
    recent: [],
    truncated: false,
  };

  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return result;
  }

  const files = entries.filter((entry) => entry.isFile());
  result.total = files.length;

  for (const entry of files) {
    if (result.recent.length >= MAX_SESSION_FILES) {
      result.truncated = true;
      break;
    }
    const fullPath = path.join(sessionsDir, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      result.recent.push({
        file: entry.name,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
      if (result.oldestMtimeMs === undefined || stat.mtimeMs < result.oldestMtimeMs) {
        result.oldestMtimeMs = stat.mtimeMs;
      }
      if (result.newestMtimeMs === undefined || stat.mtimeMs > result.newestMtimeMs) {
        result.newestMtimeMs = stat.mtimeMs;
      }
    } catch {
      // ignore
    }
  }

  result.recent.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return result;
}

async function detectGitHead(root: string): Promise<LocalContext["git"]> {
  let current = root;
  for (;;) {
    const gitPath = path.join(current, ".git");
    try {
      const stat = await fs.stat(gitPath);
      if (stat.isDirectory()) {
        const head = await fs.readFile(path.join(gitPath, "HEAD"), "utf8");
        return { root: current, head: head.trim() };
      }
    } catch {
      // ignore
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return {};
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function formatTime(ms?: number): string {
  if (!ms) return "N/A";
  return new Date(ms).toISOString();
}

function summarizeLocalContext(context: LocalContext): string {
  const lines: string[] = [];
  lines.push("Workspace roots:");
  for (const root of context.roots) {
    lines.push(`- ${root}`);
  }

  const stats = context.fileStats;
  lines.push("");
  lines.push("File scan summary:");
  lines.push(`- Total files scanned: ${stats.totalFiles}`);
  lines.push(`- Total size: ${formatBytes(stats.totalBytes)}`);
  lines.push(`- Truncated: ${stats.truncated ? "yes" : "no"}`);
  lines.push(`- Oldest mtime: ${formatTime(stats.oldestMtimeMs)}`);
  lines.push(`- Newest mtime: ${formatTime(stats.newestMtimeMs)}`);

  const extEntries = Object.entries(stats.extensionCounts);
  extEntries.sort((a, b) => b[1] - a[1]);
  lines.push("");
  lines.push("Top extensions:");
  for (const [ext, count] of extEntries.slice(0, 20)) {
    lines.push(`- ${ext}: ${count}`);
  }

  lines.push("");
  lines.push("Most recently modified files:");
  for (const entry of stats.recentFiles.slice(0, 30)) {
    lines.push(`- ${entry.path} | ${formatTime(entry.mtimeMs)} | ${formatBytes(entry.size)}`);
  }

  lines.push("");
  lines.push("Largest files:");
  for (const entry of stats.largestFiles.slice(0, 20)) {
    lines.push(`- ${entry.path} | ${formatBytes(entry.size)} | ${formatTime(entry.mtimeMs)}`);
  }

  lines.push("");
  lines.push("Sessions:");
  lines.push(`- Total sessions: ${context.sessions.total}`);
  lines.push(`- Truncated: ${context.sessions.truncated ? "yes" : "no"}`);
  lines.push(`- Oldest session: ${formatTime(context.sessions.oldestMtimeMs)}`);
  lines.push(`- Newest session: ${formatTime(context.sessions.newestMtimeMs)}`);
  lines.push("Recent session files:");
  for (const entry of context.sessions.recent.slice(0, 20)) {
    lines.push(`- ${entry.file} | ${formatTime(entry.mtimeMs)} | ${formatBytes(entry.size)}`);
  }

  if (context.git?.root) {
    lines.push("");
    lines.push("Git:");
    lines.push(`- Root: ${context.git.root}`);
    if (context.git.head) {
      lines.push(`- HEAD: ${context.git.head}`);
    }
    if (context.git.changesSince) {
      const since = context.git.changesSince.sinceMs;
      lines.push(
        `- Changes since last report: ${since ? formatTime(since) : "N/A"}`,
      );
      lines.push(`- Truncated: ${context.git.changesSince.truncated ? "yes" : "no"}`);
      if (context.git.changesSince.committed.length > 0) {
        lines.push("Committed changes:");
        for (const file of context.git.changesSince.committed.slice(0, 50)) {
          lines.push(`- ${file}`);
        }
      }
      if (context.git.changesSince.uncommitted.length > 0) {
        lines.push("Uncommitted changes:");
        for (const file of context.git.changesSince.uncommitted.slice(0, 50)) {
          lines.push(`- ${file}`);
        }
      }
    }
  }

  return lines.join("\n");
}

async function collectLocalContext(
  workspaceDir: string,
  agentId: string,
  lastReportTimeMs?: number,
): Promise<LocalContext> {
  const roots = [workspaceDir];
  const fileStats = await walkFiles(workspaceDir);
  const sessions = await collectSessionStats(agentId);
  const gitHead = await detectGitHead(workspaceDir);
  const gitChanges = await collectGitChanges(workspaceDir, lastReportTimeMs);
  const git = {
    root: gitChanges.root || gitHead.root,
    head: gitChanges.head || gitHead.head,
    changesSince: gitChanges.changesSince,
  };

  return {
    roots,
    fileStats,
    sessions,
    git,
  };
}

/**
 * Collect work context from local snapshot with optional AI summary
 */
export async function collectWorkContext(
  hoursBack: number = 0,
  deps?: WorkContextDependencies,
  lastReportTimeMs?: number,
): Promise<WorkContextSummary> {
  const endTime = Date.now();
  const fullScan = hoursBack <= 0;

  if (!deps) {
    console.log("[Work Context] Dependencies not provided, returning placeholder");
    return {
      period: {
        startTime: endTime - Math.max(0, hoursBack) * 60 * 60 * 1000,
        endTime,
        durationHours: Math.max(0, hoursBack),
      },
      sessions: { total: 0, recentFiles: [] },
      activity: { tasksCompleted: [], filesModified: [], commandsRun: [], keyTopics: [] },
      summary: "Work context collection unavailable (dependencies not provided)",
      summaryStatus: "error",
      summaryError: "missing_dependencies",
    };
  }

  console.log("\n[Work Context] Collecting local context...");

  try {
    const { config } = deps;
    const workspaceDir = deps.workspaceDir?.trim() || process.cwd();
    let coreDeps: Awaited<ReturnType<typeof loadCoreAgentDeps>> | null = null;
    let coreDepsError: string | undefined;
    let agentId = "main";

    try {
      coreDeps = await loadCoreAgentDeps();
      if (coreDeps.DEFAULT_AGENT_ID) {
        agentId = coreDeps.DEFAULT_AGENT_ID;
      }
    } catch (error) {
      coreDepsError = error instanceof Error ? error.message : String(error);
    }

    const localContext = await collectLocalContext(workspaceDir, agentId, lastReportTimeMs);
    const rawContext = summarizeLocalContext(localContext);
    const trimmedContext = truncateText(rawContext, MAX_CONTEXT_CHARS);

    let summaryStatus: WorkContextSummary["summaryStatus"] = "ok";
    let summaryError: string | undefined;
    let aiSummary: string | null = null;

    if (coreDeps) {
      const sessionId = `work-context-${Date.now()}`;
      const resolvedWorkspaceDir =
        deps.workspaceDir?.trim() || coreDeps.resolveAgentWorkspaceDir(config, agentId);
      const sessionFile = coreDeps.resolveSessionTranscriptPath(sessionId, agentId);
      const agentDir = coreDeps.resolveAgentDir(config, agentId);

      try {
        await coreDeps.ensureAgentWorkspace({ dir: resolvedWorkspaceDir });

        const { provider, model } = resolveProviderModel(config, {
          provider: coreDeps.DEFAULT_PROVIDER,
          model: coreDeps.DEFAULT_MODEL,
        });

        const promptTime = fullScan ? "all available history" : `the past ${hoursBack} hours`;
        const prompt = [
          `Summarize the user's work context based on the local snapshot below (${promptTime}).`,
          "Include concrete details (files, tasks, progress, key topics).",
          "Respond in concise markdown and keep important file paths.",
          "",
          "Local snapshot:",
          trimmedContext,
        ].join("\n");

        const result = await coreDeps.runEmbeddedPiAgent({
          sessionId,
          sessionFile,
          workspaceDir: resolvedWorkspaceDir,
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
        if (result.meta?.aborted) {
          summaryStatus = "error";
          summaryError = "aborted";
        } else if (hasErrorPayload) {
          summaryStatus = "error";
          summaryError = "payload_error";
        } else if (!summary || summary.length < 5) {
          summaryStatus = "error";
          summaryError = "empty_summary";
        } else if (summary === "No work record") {
          summaryStatus = "no_data";
        } else {
          aiSummary = summary;
        }
      } catch (error) {
        summaryStatus = "error";
        summaryError = error instanceof Error ? error.message : String(error);
      }
    } else {
      summaryStatus = "error";
      summaryError = coreDepsError || "core_deps_unavailable";
    }

    const summaryHeader = "## Work Context Summary";
    const rawHeader = "## Raw Context (local snapshot)";
    const combinedSummary = aiSummary
      ? `${summaryHeader}\n${aiSummary}\n\n${rawHeader}\n${trimmedContext}`
      : `${rawHeader}\n${trimmedContext}`;
    const finalSummary = truncateText(combinedSummary, MAX_CONTEXT_CHARS);

    console.log(`[Work Context] Summary generated (${finalSummary.length} chars)`);

    return {
      period: {
        startTime: fullScan
          ? (localContext.fileStats.oldestMtimeMs ?? localContext.sessions.oldestMtimeMs ?? endTime)
          : endTime - hoursBack * 60 * 60 * 1000,
        endTime,
        durationHours: fullScan
          ? Math.max(
              1,
              Math.round(
                (endTime -
                  (localContext.fileStats.oldestMtimeMs ??
                    localContext.sessions.oldestMtimeMs ??
                    endTime)) /
                  (60 * 60 * 1000),
              ),
            )
          : hoursBack,
      },
      sessions: {
        total: localContext.sessions.total,
        recentFiles: localContext.fileStats.recentFiles.map((f) => f.path),
      },
      activity: {
        tasksCompleted: [],
        filesModified: localContext.fileStats.recentFiles.map((f) => f.path),
        commandsRun: [],
        keyTopics: Object.keys(localContext.fileStats.extensionCounts).slice(0, 10),
      },
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
