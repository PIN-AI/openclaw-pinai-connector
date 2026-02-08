import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type CoreConfig = {
  agents?: unknown;
  session?: {
    store?: string;
  };
  [key: string]: unknown;
};

type CoreAgentDeps = {
  resolveAgentDir: (cfg: CoreConfig, agentId: string) => string;
  resolveAgentWorkspaceDir: (cfg: CoreConfig, agentId: string) => string;
  ensureAgentWorkspace: (params?: { dir?: string }) => Promise<{ dir: string }>;
  resolveSessionTranscriptPath: (sessionId: string, agentId?: string, topicId?: string | number) => string;
  runEmbeddedPiAgent: (params: {
    sessionId: string;
    sessionKey?: string;
    messageProvider?: string;
    sessionFile: string;
    workspaceDir: string;
    config?: CoreConfig;
    prompt: string;
    provider?: string;
    model?: string;
    thinkLevel?: string;
    verboseLevel?: string;
    timeoutMs: number;
    runId: string;
    lane?: string;
    extraSystemPrompt?: string;
    agentDir?: string;
  }) => Promise<{
    payloads?: Array<{ text?: string; isError?: boolean }>;
    meta?: { aborted?: boolean };
  }>;
  DEFAULT_MODEL: string;
  DEFAULT_PROVIDER: string;
  DEFAULT_AGENT_ID: string;
};

type ExtensionApi = {
  resolveAgentDir: CoreAgentDeps["resolveAgentDir"];
  resolveAgentWorkspaceDir: CoreAgentDeps["resolveAgentWorkspaceDir"];
  ensureAgentWorkspace: CoreAgentDeps["ensureAgentWorkspace"];
  resolveSessionFilePath: (
    sessionId: string,
    entry?: unknown,
    opts?: { agentId?: string },
  ) => string;
  runEmbeddedPiAgent: CoreAgentDeps["runEmbeddedPiAgent"];
  DEFAULT_MODEL: string;
  DEFAULT_PROVIDER: string;
};

let coreRootCache: string | null = null;
let coreDepsPromise: Promise<CoreAgentDeps> | null = null;

function findPackageRoot(startDir: string, name: string): string | null {
  let dir = startDir;
  for (;;) {
    const pkgPath = path.join(dir, "package.json");
    try {
      if (fs.existsSync(pkgPath)) {
        const raw = fs.readFileSync(pkgPath, "utf8");
        const pkg = JSON.parse(raw) as { name?: string };
        if (pkg.name === name) {
          return dir;
        }
      }
    } catch {
      // ignore parse errors and keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function resolveOpenClawRoot(): string {
  if (coreRootCache) {
    return coreRootCache;
  }
  const override = process.env.OPENCLAW_ROOT?.trim();
  if (override) {
    coreRootCache = override;
    return override;
  }

  const candidates = new Set<string>();
  if (process.argv[1]) {
    candidates.add(path.dirname(process.argv[1]));
  }
  candidates.add(process.cwd());
  try {
    const urlPath = fileURLToPath(import.meta.url);
    candidates.add(path.dirname(urlPath));
  } catch {
    // ignore
  }

  for (const start of candidates) {
    const found = findPackageRoot(start, "openclaw");
    if (found) {
      coreRootCache = found;
      return found;
    }
  }

  throw new Error("Unable to resolve OpenClaw root. Set OPENCLAW_ROOT to the package root.");
}

async function importCoreModule<T>(relativePath: string): Promise<T> {
  const root = resolveOpenClawRoot();
  const distPath = path.join(root, "dist", relativePath);
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Missing core module at ${distPath}. Run \`pnpm build\` or install the official package.`,
    );
  }
  return (await import(pathToFileURL(distPath).href)) as T;
}

async function loadExtensionApiDeps(): Promise<CoreAgentDeps | null> {
  const root = resolveOpenClawRoot();
  const extPath = path.join(root, "dist", "extensionAPI.js");
  if (!fs.existsSync(extPath)) {
    return null;
  }

  const ext = (await import(pathToFileURL(extPath).href)) as ExtensionApi;

  return {
    resolveAgentDir: ext.resolveAgentDir,
    resolveAgentWorkspaceDir: ext.resolveAgentWorkspaceDir,
    ensureAgentWorkspace: ext.ensureAgentWorkspace,
    resolveSessionTranscriptPath: (sessionId, agentId) =>
      ext.resolveSessionFilePath(sessionId, undefined, { agentId }),
    runEmbeddedPiAgent: ext.runEmbeddedPiAgent,
    DEFAULT_MODEL: ext.DEFAULT_MODEL,
    DEFAULT_PROVIDER: ext.DEFAULT_PROVIDER,
    DEFAULT_AGENT_ID: "main",
  };
}

export async function loadCoreAgentDeps(): Promise<CoreAgentDeps> {
  if (coreDepsPromise) {
    return coreDepsPromise;
  }

  coreDepsPromise = (async () => {
    const extensionApiDeps = await loadExtensionApiDeps();
    if (extensionApiDeps) {
      return extensionApiDeps;
    }

    const [
      agentScope,
      workspace,
      sessions,
      piEmbedded,
      defaults,
      routing,
    ] = await Promise.all([
      importCoreModule<{
        resolveAgentDir: CoreAgentDeps["resolveAgentDir"];
        resolveAgentWorkspaceDir: CoreAgentDeps["resolveAgentWorkspaceDir"];
      }>("agents/agent-scope.js"),
      importCoreModule<{
        ensureAgentWorkspace: CoreAgentDeps["ensureAgentWorkspace"];
      }>("agents/workspace.js"),
      importCoreModule<{
        resolveSessionTranscriptPath: CoreAgentDeps["resolveSessionTranscriptPath"];
      }>("config/sessions.js"),
      importCoreModule<{
        runEmbeddedPiAgent: CoreAgentDeps["runEmbeddedPiAgent"];
      }>("agents/pi-embedded.js"),
      importCoreModule<{
        DEFAULT_MODEL: string;
        DEFAULT_PROVIDER: string;
      }>("agents/defaults.js"),
      importCoreModule<{
        DEFAULT_AGENT_ID: string;
      }>("routing/session-key.js"),
    ]);

    return {
      resolveAgentDir: agentScope.resolveAgentDir,
      resolveAgentWorkspaceDir: agentScope.resolveAgentWorkspaceDir,
      ensureAgentWorkspace: workspace.ensureAgentWorkspace,
      resolveSessionTranscriptPath: sessions.resolveSessionTranscriptPath,
      runEmbeddedPiAgent: piEmbedded.runEmbeddedPiAgent,
      DEFAULT_MODEL: defaults.DEFAULT_MODEL,
      DEFAULT_PROVIDER: defaults.DEFAULT_PROVIDER,
      DEFAULT_AGENT_ID: routing.DEFAULT_AGENT_ID,
    };
  })();

  return coreDepsPromise;
}
