import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createStore, Spec, type SpecStore } from "./store.js";

const store: SpecStore = createStore();

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

const mcpServer = new McpServer({
  name: "figma-product-specs",
  version: "0.1.0",
});

mcpServer.registerTool(
  "list_specs",
  {
    description:
      "List the product specs that have been published from the Figma widget. Returns each spec's id, nodeId and the time it was last updated.",
    inputSchema: {},
  },
  async () => {
    const rows = await store.list();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }],
    };
  }
);

mcpServer.registerTool(
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

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", async (_req, res) => {
  const rows = await store.list();
  res.json({ ok: true, specs: rows.length });
});

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

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport | undefined = sessionId ? transports.get(sessionId) : undefined;

  if (!transport && !sessionId && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
    });
    transport.onclose = () => {
      if (transport!.sessionId) transports.delete(transport!.sessionId);
    };
    await mcpServer.connect(transport);
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

async function main() {
  await store.init();
  const port = Number(process.env.PORT) || 8080;
  app.listen(port, "0.0.0.0", () => {
    console.log(`MCP server listening on :${port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});