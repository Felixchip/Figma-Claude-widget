import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { configReady, loadConfig, type GitHubConfig } from "./github.js";
import {
  runTool,
  getRepoOverview,
  listComponents,
  getComponent,
  getRepoStructure,
  searchComponents,
  TOOL_DEFS,
} from "./tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const cfg: GitHubConfig = loadConfig();

function toContent(result: Awaited<ReturnType<typeof runTool>>) {
  return {
    content: [{ type: "text" as const, text: result.text }],
    isError: result.isError,
  };
}

// ---------------------------------------------------------------------------
// HTTP app: MCP endpoint + REST + web UI
// ---------------------------------------------------------------------------

const app = express();
app.use(cors({ exposedHeaders: ["Mcp-Session-Id"] }));
app.use(express.json());

app.get("/api/status", (_req, res) => {
  res.json({
    configured: configReady(cfg),
    repo: cfg.owner && cfg.repo ? `${cfg.owner}/${cfg.repo}` : null,
    tools: Object.keys(TOOL_DEFS),
  });
});

app.post("/api/tools/:name", async (req, res) => {
  const name = req.params.name;
  if (!(name in TOOL_DEFS)) {
    res.status(404).json({ error: `Unknown tool '${name}'` });
    return;
  }
  try {
    const result = await runTool(cfg, name, req.body ?? {});
    res.json({ result: result.text, isError: result.isError ?? false });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const transports = new Map<string, StreamableHTTPServerTransport>();

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "github-components",
    version: "0.1.0",
  });
  server.registerTool(
    "get_repo_overview",
    { description: TOOL_DEFS.get_repo_overview.description, inputSchema: {} },
    async () => toContent(await getRepoOverview(cfg))
  );
  server.registerTool(
    "list_components",
    {
      description: TOOL_DEFS.list_components.description,
      inputSchema: {
        query: z.string().optional().describe("Optional substring to filter component names/paths by."),
        limit: z.number().min(1).max(200).optional().describe("Max results (default 100)."),
      },
    },
    async ({ query, limit }) => toContent(await listComponents(cfg, query, limit))
  );
  server.registerTool(
    "get_component",
    {
      description: TOOL_DEFS.get_component.description,
      inputSchema: { path: z.string().describe("File path in the repo, e.g. 'src/components/Button.tsx'.") },
    },
    async ({ path }) => toContent(await getComponent(cfg, path))
  );
  server.registerTool(
    "get_repo_structure",
    { description: TOOL_DEFS.get_repo_structure.description, inputSchema: {} },
    async () => toContent(await getRepoStructure(cfg))
  );
  server.registerTool(
    "search_components",
    {
      description: TOOL_DEFS.search_components.description,
      inputSchema: { query: z.string().describe("Keyword to search component names and paths for.") },
    },
    async ({ query }) => toContent(await searchComponents(cfg, query))
  );
  return server;
}

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

app.use(express.static(PUBLIC_DIR));

app.get("/health", (_req, res) => {
  res.json({ ok: true, configured: configReady(cfg) });
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, "0.0.0.0", () => {
  console.log(`GitHub MCP server listening on :${port}`);
  console.log(`Configured repo: ${cfg.owner}/${cfg.repo || "(unset)"}`);
});