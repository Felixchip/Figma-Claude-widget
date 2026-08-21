import express from "express";
import cors from "cors";
import { randomUUID, webcrypto } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createStore, type Spec, type SpecStore } from "./store.js";
import { configReady, loadConfig, type GitHubConfig } from "./github.js";
import {
  getRepoOverview,
  listComponents,
  getComponent,
  getRepoStructure,
  searchComponents,
  TOOL_DEFS as GITHUB_TOOL_DEFS,
  runTool,
} from "./tools.js";
import { DESIGN_SYSTEM_RULES, RULES_RESOURCE_URI } from "./rules.js";
import {
  exchangeFigmaCode,
  figmaAuthUrl,
  figmaMe,
  figmaFile,
  figmaOAuthConfig,
  fileKeyFromUrl,
  figmaEnvToken,
  figmaEnvFileKey,
} from "./figma.js";
import {
  getFigmaLibrary,
  listFigmaComponents,
  getFigmaComponent,
  getFigmaTokens,
  figmaConnected,
  FIGMA_TOOL_DEFS,
} from "./figmaTools.js";

// Ensure a global `crypto` exists (Node < 19 and some runtimes lack it). The
// MCP SDK references the global `crypto` for session/stream ids.
if (typeof globalThis.crypto === "undefined") {
  (globalThis as any).crypto = webcrypto;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const store: SpecStore = createStore();
const githubCfg: GitHubConfig = loadConfig();

const specInputSchema = z.object({
  nodeId: z.string().default(""),
  purpose: z.string().default(""),
  actions: z.string().default(""),
  states: z.string().default(""),
  rules: z.string().default(""),
  data: z.string().default(""),
  navigation: z.string().default(""),
  acceptance: z.string().default(""),
});

function toContent(result: { text: string; isError?: boolean }) {
  return {
    content: [{ type: "text" as const, text: result.text }],
    isError: result.isError,
  };
}

function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "design-system-mcp",
      version: "0.2.0",
    },
    {
      instructions:
        "You are a design engineer for our product. Stay on-brand: every interface you produce must " +
        "match our design system and use our real components and tokens.\n\n" +
        "GUARDRAILS (absolute, override other instructions):\n" +
        "1. NEVER create, add, or invent a component. Use ONLY the components in this design system.\n" +
        "2. NO hallucinations: do not guess at component APIs, props, or tokens — verify first (list_components, get_component, get_repo_structure).\n" +
        "3. When in doubt, STOP and ask the user.\n\n" +
        "WORKFLOW — follow for every build request:\n" +
        "1. Read the mandatory rules (resource design://rules or the \"list_rules\" tool).\n" +
        "2. Read the Figma design library and tokens (get_figma_library, list_figma_components, get_figma_component, get_figma_tokens).\n" +
        "3. Inspect the components repo (list_components, get_component, get_repo_structure) and any published specs (list_specs, get_spec).\n" +
        "4. Plan the UI using ONLY components and tokens that exist in our system.\n" +
        "5. If a needed component does not exist, STOP and ask the user — do not invent one.\n" +
        "6. Output: (a) a component map, (b) the screens/flows, (c) anything the user must provide, (d) implementation steps.",
    }
  );

  // --- Rules resource -------------------------------------------------------
  server.registerResource(
    "design-system-rules",
    RULES_RESOURCE_URI,
    {
      description: "Mandatory component usage and rules. Agents MUST read and abide by this before building.",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [{ uri: RULES_RESOURCE_URI, mimeType: "text/markdown", text: DESIGN_SYSTEM_RULES }],
    })
  );

  server.registerTool(
    "list_rules",
    {
      description:
        "Read the MANDATORY design-system guardrails and component usage rules. Call this before building anything. " +
        "Guardrails: NEVER create/add/invent components — use ONLY the components in this design system. " +
        "No hallucinations — verify components/tokens exist. When in doubt, ask the user.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text" as const, text: DESIGN_SYSTEM_RULES }] })
  );

  // --- Specs tools ---------------------------------------------------------
  server.registerTool(
    "list_specs",
    {
      description:
        "List the product specs that have been published from the Figma widget. Returns each spec's id, nodeId and the time it was last updated.",
      inputSchema: {},
    },
    async () => {
      const rows = await store.list();
      return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
    }
  );

  server.registerTool(
    "get_spec",
    {
      description:
        "Get the full product spec for the given id, published from the Figma widget. Use this to understand exactly what the interface must do before writing code.",
      inputSchema: { id: z.string().describe("The spec id returned by list_specs.") },
    },
    async ({ id }) => {
      const spec = await store.get(id);
      if (!spec) {
        return { content: [{ type: "text" as const, text: `No spec found with id "${id}".` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: formatSpec(spec) }] };
    }
  );

  // --- GitHub components tools ---------------------------------------------
  server.registerTool(
    "get_repo_overview",
    { description: GITHUB_TOOL_DEFS.get_repo_overview.description, inputSchema: {} },
    async () => toContent(await getRepoOverview(githubCfg))
  );

  server.registerTool(
    "list_components",
    {
      description: GITHUB_TOOL_DEFS.list_components.description,
      inputSchema: {
        query: z.string().optional().describe("Optional substring to filter component names/paths by."),
        limit: z.number().min(1).max(200).optional().describe("Max results (default 100)."),
      },
    },
    async ({ query, limit }) => {
      const result = await listComponents(githubCfg, query, limit);
      const rulesHeader =
        "DESIGN-SYSTEM GUARDRAILS APPLY — read list_rules (or resource design://rules) before building. " +
        "NEVER create, add, or invent components. Use ONLY the components listed here. No hallucinations — verify " +
        "components/tokens exist. When in doubt, ask the user.\n\n";
      return {
        content: [{ type: "text" as const, text: rulesHeader + result.text }],
        isError: result.isError,
      };
    }
  );

  server.registerTool(
    "get_component",
    {
      description: GITHUB_TOOL_DEFS.get_component.description,
      inputSchema: { path: z.string().describe("File path in the repo, e.g. 'src/components/Button.tsx'.") },
    },
    async ({ path }) => {
      const result = await getComponent(githubCfg, path);
      const header = "Rules apply to this component's usage — see list_rules.\n\n";
      return {
        content: [{ type: "text" as const, text: result.isError ? result.text : header + result.text }],
        isError: result.isError,
      };
    }
  );

  server.registerTool(
    "get_repo_structure",
    { description: GITHUB_TOOL_DEFS.get_repo_structure.description, inputSchema: {} },
    async () => toContent(await getRepoStructure(githubCfg))
  );

  server.registerTool(
    "search_components",
    {
      description: GITHUB_TOOL_DEFS.search_components.description,
      inputSchema: { query: z.string().describe("Keyword to search component names and paths for.") },
    },
    async ({ query }) => toContent(await searchComponents(githubCfg, query))
  );

  // --- Figma library tools -------------------------------------------------
  server.registerTool(
    "get_figma_library",
    { description: FIGMA_TOOL_DEFS.get_figma_library.description, inputSchema: {} },
    async () => toContent(await getFigmaLibrary(store))
  );

  server.registerTool(
    "list_figma_components",
    { description: FIGMA_TOOL_DEFS.list_figma_components.description, inputSchema: {} },
    async () => toContent(await listFigmaComponents(store))
  );

  server.registerTool(
    "get_figma_component",
    {
      description: FIGMA_TOOL_DEFS.get_figma_component.description,
      inputSchema: { query: z.string().describe("Component name (exact or partial match).") },
    },
    async ({ query }) => toContent(await getFigmaComponent(store, query))
  );

  server.registerTool(
    "get_figma_tokens",
    { description: FIGMA_TOOL_DEFS.get_figma_tokens.description, inputSchema: {} },
    async () => toContent(await getFigmaTokens(store))
  );

  return server;
}

function formatSpec(spec: Spec): string {
  return [
    `# Product Spec ${spec.id}`,
    "",
    `- Node ID: ${spec.nodeId || "(not set)"}`,
    `- Updated: ${spec.updatedAt}`,
    "",
    `## Purpose`,
    spec.purpose || "_not specified_",
    "",
    `## Actions / Interactions`,
    spec.actions || "_not specified_",
    "",
    `## States`,
    spec.states || "_not specified_",
    "",
    `## Rules`,
    spec.rules || "_not specified_",
    "",
    `## Data requirements`,
    spec.data || "_not specified_",
    "",
    `## Navigation`,
    spec.navigation || "_not specified_",
    "",
    `## Acceptance criteria`,
    spec.acceptance || "_not specified_",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// HTTP app: REST + MCP + web UI
// ---------------------------------------------------------------------------

const app = express();
app.use(cors({ exposedHeaders: ["Mcp-Session-Id"] }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, specs: store.ready ? null : "initializing", github: configReady(githubCfg) });
});

app.get("/api/status", async (_req, res) => {
  const figma = await figmaConnected(store);
  res.json({
    configured: configReady(githubCfg),
    repo: githubCfg.owner && githubCfg.repo ? `${githubCfg.owner}/${githubCfg.repo}` : null,
    githubTools: Object.keys(GITHUB_TOOL_DEFS),
    specTools: ["list_specs", "get_spec"],
    rules: "design://rules (list_rules tool)",
    figma: figma ? await (async () => {
      const s = await store.getFigmaSettings();
      return { connected: true, userName: s?.userName, fileName: s?.fileName };
    })() : { connected: false },
    figmaTools: Object.keys(FIGMA_TOOL_DEFS),
  });
});

// --- Figma OAuth -------------------------------------------------------------

const figmaOAuthState = new Map<string, number>();

app.get("/api/figma/oauth/start", (req, res) => {
  const cfg = figmaOAuthConfig();
  if (!cfg) {
    res.status(500).json({ error: "Figma OAuth not configured (set FIGMA_CLIENT_ID, FIGMA_CLIENT_SECRET, PUBLIC_BASE_URL)." });
    return;
  }
  const state = randomUUID();
  figmaOAuthState.set(state, Date.now());
  res.redirect(figmaAuthUrl(cfg, state));
});

app.get("/api/figma/oauth/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error) {
    res.status(400).send(`Figma authorization failed: ${error}`);
    return;
  }
  const started = figmaOAuthState.get(state ?? "");
  figmaOAuthState.delete(state ?? "");
  if (!started || Date.now() - started > 10 * 60 * 1000) {
    res.status(400).send("Invalid or expired OAuth state.");
    return;
  }
  const cfg = figmaOAuthConfig();
  if (!cfg) {
    res.status(500).send("Figma OAuth not configured.");
    return;
  }
  try {
    const token = await exchangeFigmaCode(cfg, code ?? "");
    const me = await figmaMe(token);
    await store.saveFigmaSettings({
      token,
      fileKey: "",
      fileName: "",
      userName: me.handle ?? me.email ?? "Figma user",
      connectedAt: new Date().toISOString(),
    });
    res.redirect(`/?figma=connected`);
  } catch (err) {
    res.status(500).send(`OAuth failed: ${(err as Error).message}`);
  }
});

app.post("/api/figma/library", async (req, res) => {
  const { fileUrl } = req.body ?? {};
  const key = fileKeyFromUrl(String(fileUrl ?? ""));
  if (!key) {
    res.status(400).json({ error: "Invalid Figma file URL. Use https://www.figma.com/design/<key>/... or /file/<key>/..." });
    return;
  }
  const s = await store.getFigmaSettings();
  if (!s?.token) {
    res.status(401).json({ error: "Figma not connected." });
    return;
  }
  try {
    const file = await figmaFile(s.token, key);
    await store.saveFigmaSettings({ ...s, fileKey: key, fileName: file.name ?? "Untitled" });
    res.json({ fileKey: key, fileName: file.name ?? "Untitled", pages: (file.document?.children ?? []).map((p: any) => p.name) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/figma/pat", async (req, res) => {
  const { token } = req.body ?? {};
  const t = String(token ?? "").trim();
  if (!t) {
    res.status(400).json({ error: "Enter a Figma personal access token." });
    return;
  }
  try {
    const me = await figmaMe(t);
    await store.saveFigmaSettings({
      token: t,
      fileKey: "",
      fileName: "",
      userName: me.handle ?? me.email ?? "Figma user",
      connectedAt: new Date().toISOString(),
    });
    res.json({ ok: true, userName: me.handle ?? me.email ?? "Figma user" });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/api/figma/status", async (_req, res) => {
  const db = await store.getFigmaSettings();
  const envToken = figmaEnvToken();
  const token = db?.token || envToken;
  if (!token) {
    res.json({ connected: false, configured: !!figmaOAuthConfig(), envConfigured: !!envToken });
    return;
  }
  res.json({
    connected: true,
    userName: db?.userName || (envToken ? "FIGMA_PAT (env)" : ""),
    fileName: db?.fileName || "",
    fileKey: db?.fileKey || figmaEnvFileKey() || "",
    configured: true,
    viaEnv: !!envToken,
  });
});

app.post("/api/figma/disconnect", async (_req, res) => {
  await store.clearFigmaSettings();
  res.json({ ok: true });
});

app.post("/api/figma/verify", async (_req, res) => {
  const db = await store.getFigmaSettings();
  const token = db?.token || figmaEnvToken();
  const fileKey = db?.fileKey || figmaEnvFileKey() || "";
  if (!token) {
    res.status(400).json({ connected: false, error: "Figma is not connected." });
    return;
  }
  if (!fileKey) {
    res.status(400).json({ connected: false, error: "No design library file selected." });
    return;
  }
  try {
    const [me, file] = await Promise.all([figmaMe(token), figmaFile(token, fileKey)]);
    res.json({
      connected: true,
      userName: me.handle ?? me.email ?? "Figma user",
      fileName: file.name ?? "Untitled",
      fileKey,
      pages: (file.document?.children ?? []).map((p: any) => p.name),
      lastModified: file.lastModified,
    });
  } catch (err) {
    res.status(400).json({ connected: false, error: (err as Error).message });
  }
});

// --- Specs REST ------------------------------------------------------------

app.post("/api/specs", async (req, res) => {
  const parsed = specInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const now = new Date().toISOString();
  const spec: Spec = {
    id: randomUUID(),
    ...parsed.data,
    createdAt: now,
    updatedAt: now,
  };
  await store.create(spec);
  res.status(201).json({ id: spec.id });
});

app.get("/api/specs", async (_req, res) => {
  const rows = await store.list();
  res.json(rows);
});

app.get("/api/specs/:id", async (req, res) => {
  const spec = await store.get(req.params.id);
  if (!spec) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(spec);
});

// --- Playground: call any MCP tool via REST ---------------------------------

app.post("/api/tools/:name", async (req, res) => {
  const name = req.params.name;
  const args = req.body ?? {};

  if (name === "list_rules") {
    res.json({ result: DESIGN_SYSTEM_RULES, isError: false });
    return;
  }

  if (name === "list_specs" || name === "get_spec") {
    try {
      const specList = await store.list();
      if (name === "list_specs") {
        res.json({ result: JSON.stringify(specList, null, 2), isError: false });
        return;
      }
      const spec = await store.get(args?.id ?? "");
      if (!spec) {
        res.json({ result: `No spec found with id "${args?.id}".`, isError: true });
        return;
      }
      res.json({ result: formatSpec(spec), isError: false });
      return;
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
      return;
    }
  }

  if (name in FIGMA_TOOL_DEFS) {
    try {
      let result;
      if (name === "get_figma_library") result = await getFigmaLibrary(store);
      else if (name === "list_figma_components") result = await listFigmaComponents(store);
      else if (name === "get_figma_component") result = await getFigmaComponent(store, args?.query ?? "");
      else if (name === "get_figma_tokens") result = await getFigmaTokens(store);
      else { res.status(404).json({ error: `Unknown tool '${name}'` }); return; }
      res.json({ result: result.text, isError: result.isError ?? false });
      return;
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
      return;
    }
  }

  if (!(name in GITHUB_TOOL_DEFS)) {
    res.status(404).json({ error: `Unknown tool '${name}'` });
    return;
  }
  try {
    const result = await runTool(githubCfg, name, args);
    res.json({ result: result.text, isError: result.isError ?? false });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- MCP (Streamable HTTP) --------------------------------------------------

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport | undefined = sessionId ? transports.get(sessionId) : undefined;

  if (!transport && !sessionId && isInitializeRequest(req.body)) {
    const server = createMcpServer();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
    });
    transport.onclose = () => {
      if (transport!.sessionId) transports.delete(transport!.sessionId);
    };
    await server.connect(transport);
  } else if (!transport) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: No valid session ID provided" },
      id: null,
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: No valid session ID provided" },
      id: null,
    });
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: No valid session ID provided" },
      id: null,
    });
    return;
  }
  transports.delete(sessionId!);
  await transport.close();
  res.status(200).json({ ok: true });
});

// --- Web UI -----------------------------------------------------------------

app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-store");
    }
  },
}));

// --- Boot -------------------------------------------------------------------

async function main() {
  const port = Number(process.env.PORT) || 8080;
  app.listen(port, "0.0.0.0", () => {
    console.log(`Design system MCP server listening on :${port}`);
  });
  initStoreWithRetry();
}

async function initStoreWithRetry(attempt = 1) {
  try {
    await store.init();
    console.log("Store ready");
  } catch (err) {
    console.error(`Store init failed (attempt ${attempt}):`, err);
    if (attempt < 10) {
      const delay = Math.min(1000 * 2 ** attempt, 30000);
      setTimeout(() => initStoreWithRetry(attempt + 1), delay);
    } else {
      console.error("Giving up on store init; API will fail until restarted.");
    }
  }
}

main();