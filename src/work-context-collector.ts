/**
 * Work Context Collector
 * Collects local work context snapshot (no local AI summary)
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  context: string;
  contextStatus?: "ok" | "error";
  contextError?: string;
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
  conversations: {
    totalMessages: number;
    totalUserMessages: number;
    totalAssistantMessages: number;
    excerpts: Array<{
      role: string;
      text: string;
      timestamp?: number;
      sessionFile?: string;
    }>;
    truncated: boolean;
  };
  git?: {
    root?: string;
    head?: string;
    changesSince?: {
      sinceMs?: number;
      commits: Array<{
        hash: string;
        date: string;
        subject: string;
        files: string[];
      }>;
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
const MAX_CONTEXT_CHARS = 12000;
const MAX_GIT_FILES = 200;
const MAX_MESSAGE_CHARS = 400;
const MAX_MESSAGE_ITEMS = 160;
const MAX_CONVERSATION_FILES = 20;
const MAX_GIT_COMMITS = 30;

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

function extractMessageText(message: Record<string, unknown>): string | null {
  const content = message.content;
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const record = item as Record<string, unknown>;
        if (typeof record.text === "string") {
          return record.text;
        }
        if (typeof record.content === "string") {
          return record.content;
        }
        return "";
      })
      .filter((text) => text.trim().length > 0);
    const joined = parts.join("\n").trim();
    return joined.length > 0 ? joined : null;
  }
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed ? trimmed : null;
  }
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string" && record.text.trim()) {
      return record.text.trim();
    }
  }
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim();
  }
  return null;
}

async function collectConversationExcerpts(agentId: string): Promise<LocalContext["conversations"]> {
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw");
  const sessionsDir = path.join(stateDir, "agents", agentId, "sessions");
  const result: LocalContext["conversations"] = {
    totalMessages: 0,
    totalUserMessages: 0,
    totalAssistantMessages: 0,
    excerpts: [],
    truncated: false,
  };

  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return result;
  }

  const sessionFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".jsonl"))
    .filter((name) => name !== "sessions.json")
    .filter((name) => !name.startsWith("work-context-"));

  const fileStats = await Promise.all(
    sessionFiles.map(async (name) => {
      const fullPath = path.join(sessionsDir, name);
      try {
        const stat = await fs.stat(fullPath);
        return { name, fullPath, mtimeMs: stat.mtimeMs, size: stat.size };
      } catch {
        return null;
      }
    }),
  );

  const sortedFiles = fileStats
    .filter((item): item is { name: string; fullPath: string; mtimeMs: number; size: number } =>
      Boolean(item),
    )
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_CONVERSATION_FILES);

  for (const file of sortedFiles) {
    if (result.excerpts.length >= MAX_MESSAGE_ITEMS) {
      result.truncated = true;
      break;
    }

    let raw = "";
    try {
      raw = await fs.readFile(file.fullPath, "utf8");
    } catch {
      continue;
    }

    const lines = raw.split("\n").filter(Boolean);
    for (const line of lines) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      const message = parsed.message as Record<string, unknown> | undefined;
      if (!message || typeof message !== "object") {
        continue;
      }

      const role = typeof message.role === "string" ? message.role : "unknown";
      const text = extractMessageText(message);
      if (!text) {
        continue;
      }

      result.totalMessages += 1;
      if (role === "user") {
        result.totalUserMessages += 1;
      } else if (role === "assistant") {
        result.totalAssistantMessages += 1;
      }

      if (role !== "user" && role !== "assistant") {
        continue;
      }

      const truncatedText = truncateText(text, MAX_MESSAGE_CHARS);
      const timestamp =
        typeof message.timestamp === "number"
          ? message.timestamp
          : typeof parsed.timestamp === "number"
            ? parsed.timestamp
            : undefined;

      result.excerpts.push({
        role,
        text: truncatedText,
        timestamp,
        sessionFile: file.name,
      });

      if (result.excerpts.length >= MAX_MESSAGE_ITEMS) {
        result.truncated = true;
        break;
      }
    }
  }

  result.excerpts.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return result;
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
  const commits: Array<{ hash: string; date: string; subject: string; files: string[] }> = [];
  let truncated = false;

  if (sinceMs && sinceMs > 0) {
    const sinceIso = new Date(sinceMs).toISOString();
    const logResult = await runGit(
      ["log", "--name-status", "--since", sinceIso, "--date=iso", "--pretty=format:%H|%ad|%s"],
      workspaceDir,
    );
    if (logResult?.stdout) {
      const seen = new Set<string>();
      let current: { hash: string; date: string; subject: string; files: string[] } | null = null;
      for (const line of logResult.stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        if (trimmed.includes("|") && trimmed.split("|").length >= 3) {
          if (current) {
            commits.push(current);
            if (commits.length >= MAX_GIT_COMMITS) {
              truncated = true;
              break;
            }
          }
          const [hash, date, subject] = trimmed.split("|");
          current = {
            hash: hash ?? "",
            date: date ?? "",
            subject: subject ?? "",
            files: [],
          };
          continue;
        }
        if (!current) {
          continue;
        }
        const filePart = trimmed.split("\t").slice(1).join("\t").trim();
        const normalized = normalizeGitPath(filePart || trimmed);
        if (!normalized || seen.has(normalized)) {
          continue;
        }
        seen.add(normalized);
        committed.push(normalized);
        current.files.push(normalized);
        if (committed.length >= MAX_GIT_FILES) {
          truncated = true;
          break;
        }
      }
      if (!truncated && current) {
        commits.push(current);
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
      commits,
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

  lines.push("");
  lines.push("Recent conversations:");
  lines.push(`- Total user messages: ${context.conversations.totalUserMessages}`);
  lines.push(`- Total assistant messages: ${context.conversations.totalAssistantMessages}`);
  lines.push(`- Total messages: ${context.conversations.totalMessages}`);
  lines.push(`- Truncated: ${context.conversations.truncated ? "yes" : "no"}`);
  for (const entry of context.conversations.excerpts.slice(0, 60)) {
    const timestamp = entry.timestamp ? formatTime(entry.timestamp) : "unknown time";
    lines.push(`- [${timestamp}] (${entry.role}) ${entry.text}`);
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
  lines.push("File scan details omitted (focus on conversations and git changes).");

  lines.push("");
  lines.push("Sessions:");
  lines.push(`- Total sessions: ${context.sessions.total}`);
  lines.push(`- Truncated: ${context.sessions.truncated ? "yes" : "no"}`);
  lines.push(`- Oldest session: ${formatTime(context.sessions.oldestMtimeMs)}`);
  lines.push(`- Newest session: ${formatTime(context.sessions.newestMtimeMs)}`);
  lines.push("Session file list omitted.");

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
      if (context.git.changesSince.commits.length > 0) {
        lines.push("Recent commits:");
        for (const commit of context.git.changesSince.commits.slice(0, 20)) {
          lines.push(`- ${commit.hash.slice(0, 8)} | ${commit.date} | ${commit.subject}`);
          if (commit.files.length > 0) {
            lines.push(`  files: ${commit.files.slice(0, 20).join(", ")}`);
          }
        }
      }
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
  const conversations = await collectConversationExcerpts(agentId);
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
    conversations,
    git,
  };
}

/**
 * Collect work context from local snapshot
 */
export async function collectWorkContext(
  hoursBack: number = 0,
  deps?: WorkContextDependencies,
  lastReportTimeMs?: number,
): Promise<WorkContextSummary> {
  const endTime = Date.now();
  const fullScan = hoursBack <= 0;
  const workspaceDir = deps?.workspaceDir?.trim() || process.cwd();
  let agentId = "main";
  let coreDepsError: string | undefined;

  try {
    const coreDeps = await loadCoreAgentDeps();
    if (coreDeps.DEFAULT_AGENT_ID) {
      agentId = coreDeps.DEFAULT_AGENT_ID;
    }
  } catch (error) {
    coreDepsError = error instanceof Error ? error.message : String(error);
  }

  console.log("\n[Work Context] Collecting local context...");

  try {
    const localContext = await collectLocalContext(workspaceDir, agentId, lastReportTimeMs);
    const rawContext = summarizeLocalContext(localContext);
    const trimmedContext = truncateText(rawContext, MAX_CONTEXT_CHARS);
    const combinedContext = `## Work Context Snapshot\n${trimmedContext}`;
    const finalContext = truncateText(combinedContext, MAX_CONTEXT_CHARS);

    if (coreDepsError) {
      console.warn(`[Work Context] Core deps unavailable: ${coreDepsError}`);
    }

    console.log(`[Work Context] Snapshot generated (${finalContext.length} chars)`);

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
        keyTopics: [],
      },
      context: finalContext,
      contextStatus: "ok",
    };
  } catch (error) {
    console.error(`[Work Context] Failed to generate snapshot: ${error}`);
    return {
      period: { startTime, endTime, durationHours: hoursBack },
      sessions: { total: 0, recentFiles: [] },
      activity: { tasksCompleted: [], filesModified: [], commandsRun: [], keyTopics: [] },
      context: `Unable to generate work snapshot: ${error instanceof Error ? error.message : String(error)}`,
      contextStatus: "error",
      contextError: error instanceof Error ? error.message : String(error),
    };
  }
}
