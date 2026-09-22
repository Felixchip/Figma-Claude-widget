import express from "express";
import cors from "cors";
import { randomUUID, webcrypto } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createStore, type Spec, type SpecStore } from "./store.js";
import { allowlistEnabled, allowlistStats, clientIp, initAllowlist, ipAllowed } from "./allowlist.js";
import { authEnabled, checkPassword, clearSessionCookie, createSessionCookie, readSession, safeNext } from "./auth.js";
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
import { RULES_PREAMBLE, DEFAULT_FOUNDATION, DEFAULT_RENDER_GUIDE, RULES_RESOURCE_URI } from "./rules.js";
import { buildRegistry, rulesToMarkdown, normalizeComponentKey, type ComponentEntry, type ComponentAlias } from "./registry.js";
import {
  exchangeFigmaCode,
  figmaAuthUrl,
  figmaMe,
  figmaFile,
  figmaFileMeta,
  figmaOAuthConfig,
  fileKeyFromUrl,
  figmaEnvToken,
  figmaEnvFileKey,
  extractComponentStats,
  extractRenderTargets,
  resolveTarget,
  type RenderTarget,
  figmaImages,
  downloadImage,
} from "./figma.js";
import {
  getFigmaLibrary,
  listFigmaComponents,
  getFigmaComponent,
  getFigmaTokens,
  figmaConnected,
  resolveFigmaWithName,
  FIGMA_TOOL_DEFS,
} from "./figmaTools.js";
import { loadSkills, skillCatalogEntry } from "./skills.js";

// Ensure a global `crypto` exists (Node < 19 and some runtimes lack it). The
// MCP SDK references the global `crypto` for session/stream ids.
if (typeof globalThis.crypto === "undefined") {
  (globalThis as any).crypto = webcrypto;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const store: SpecStore = createStore();
// Stamped when this process starts, so /api/status reveals whether a deploy took.
const BUILD_TIME = new Date().toISOString();

// package.json is the single source of truth for the version.
function readVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8");
    return JSON.parse(raw).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
const VERSION = readVersion();

// Skills are loaded once and served by every MCP session.
const SKILLS = loadSkills();
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

async function fullRules(): Promise<string> {
  // Compose: static preamble (guardrails/platform/design-sense) + editable
  // foundation + editable render guide + per-component rules.
  const existing = (await store.getRegistry()) as ComponentEntry[];
  const entries = existing.length ? existing : (await buildRegistry(githubCfg, store, [], await loadAliases())).entries;
  const foundation = (await store.getFoundation()) || DEFAULT_FOUNDATION;
  const renderGuide = (await store.getRenderGuide()) || DEFAULT_RENDER_GUIDE;
  return rulesToMarkdown(`${RULES_PREAMBLE}\n\n${foundation.trim()}\n\n${renderGuide.trim()}`, entries);
}

async function loadFoundation(): Promise<string> {
  return (await store.getFoundation()) || DEFAULT_FOUNDATION;
}

async function loadRenderGuide(): Promise<string> {
  return (await store.getRenderGuide()) || DEFAULT_RENDER_GUIDE;
}

async function loadAliases(): Promise<ComponentAlias[]> {
  return (await store.getAliases()) as ComponentAlias[];
}

// --- Figma component image rendering ---------------------------------------

async function effectiveFigma(): Promise<{ token?: string; fileKey?: string }> {
  const db = await store.getFigmaSettings();
  return { token: db?.token || figmaEnvToken(), fileKey: db?.fileKey || figmaEnvFileKey() };
}

type RenderedImage = { mime: string; base64: string; url: string } | { error: string };

// Cache the file version briefly so a run of image lookups doesn't hit Figma once
// per image (the warm-up refreshes it anyway when the file actually changes).
let versionCache: { fileKey: string; version: string; at: number } | null = null;
const VERSION_TTL_MS = 60_000;

async function cachedFileVersion(token: string, fileKey: string): Promise<string> {
  if (versionCache && versionCache.fileKey === fileKey && Date.now() - versionCache.at < VERSION_TTL_MS) {
    return versionCache.version;
  }
  const meta = await figmaFileMeta(token, fileKey);
  const version = meta.version ?? "";
  versionCache = { fileKey, version, at: Date.now() };
  return version;
}

// Render a Figma node to a PNG and cache it (keyed by node id + file version).
// Cached reads only need a cheap depth=1 version check, never the whole file.
async function renderAndCache(nodeId: string, name: string, group: string, theme = ""): Promise<RenderedImage> {
  const { token, fileKey } = await effectiveFigma();
  const cached = await store.getImage(nodeId, theme);
  const imgUrl = `/api/figma/image/${encodeURIComponent(nodeId)}${theme ? `?theme=${encodeURIComponent(theme)}` : ""}`;
  const asResult = (img: NonNullable<typeof cached>): RenderedImage => ({
    mime: img.mime,
    base64: img.data.toString("base64"),
    url: imgUrl,
  });

  if (!token || !fileKey) {
    if (cached) return asResult(cached);
    return { error: "Figma is not configured (token/file key)." };
  }

  // Themed renders only ever come from the Figma plugin (the REST image API
  // cannot pick a variable mode), so never try to render one on demand.
  if (theme && !cached) {
    return { error: `No '${theme}' render for node ${nodeId}. Export themes from the Figma plugin (GSA Build Kit Export).` };
  }

  let version = "";
  if (cached) {
    try {
      version = await cachedFileVersion(token, fileKey);
      if (version === cached.fileVersion) return asResult(cached);
    } catch {
      // Version check failed (rate limit / network): serve the cached copy.
      return asResult(cached);
    }
  } else {
    version = await cachedFileVersion(token, fileKey);
  }

  const images = await figmaImages(token, fileKey, [nodeId], { format: "png", scale: 2 });
  const src = images[nodeId];
  if (!src) return { error: `Figma returned no image for node ${nodeId}.` };
  const { data, mime } = await downloadImage(src);
  await store.saveImage({
    nodeId,
    theme,
    fileKey,
    fileVersion: version,
    name,
    group,
    mime,
    data,
    fetchedAt: new Date().toISOString(),
  });
  return { mime, base64: data.toString("base64"), url: imgUrl };
}

// ---- Background render-cache warm-up -------------------------------------
// Rendering ~75 nodes can take minutes, so we never do it inside a request
// (Railway's proxy would 502). Instead the POST starts a job and returns
// immediately; progress is polled via GET /api/figma/render/status.
type RenderJob = {
  running: boolean;
  total: number;
  done: number;
  rendered: number;
  failed: number;
  startedAt?: string;
  finishedAt?: string;
  errors: { name: string; nodeId: string; error: string }[];
};
let renderJob: RenderJob = { running: false, total: 0, done: 0, rendered: 0, failed: 0, errors: [] };

const FIGMA_BATCH = 8;

async function runRenderJob(token: string, fileKey: string): Promise<void> {
  try {
    const file = await figmaFile(token, fileKey);
    const version: string = file.version ?? "";
    const targets = extractRenderTargets(file);
    renderJob = { running: true, total: targets.length, done: 0, rendered: 0, failed: 0, startedAt: new Date().toISOString(), errors: [] };
    // Persist the name -> node map so MCP lookups don't need the whole file.
    try {
      await store.saveTargets(targets, version);
    } catch (err) {
      renderJob.errors.push({ name: "(targets)", nodeId: "", error: (err as Error).message });
    }

    // Drop cached images that are no longer targets (e.g. after a render-strategy
    // change or components removed from the file) so the cache stays clean. Only
    // the default-theme entries are ours; plugin-uploaded themes are left alone.
    const keep = new Set(targets.map((t) => t.nodeId));
    let existing: Awaited<ReturnType<typeof store.listImages>> = [];
    try {
      existing = await store.listImages();
      for (const img of existing) {
        if (img.theme === "" && !keep.has(img.nodeId)) await store.deleteImage(img.nodeId, "");
      }
    } catch (err) {
      renderJob.errors.push({ name: "(prune)", nodeId: "", error: (err as Error).message });
    }

    // Work out what actually needs rendering up front (single list query), so we
    // never call the Figma Images API for nodes we already have. This is what
    // keeps re-warms cheap and avoids rate limits.
    const cached = new Map(existing.filter((i) => i.theme === "").map((i) => [i.nodeId, i.fileVersion]));
    const pending = targets.filter((t) => cached.get(t.nodeId) !== version);
    const alreadyCached = targets.length - pending.length;
    renderJob.rendered += alreadyCached;
    renderJob.done += alreadyCached;

    for (let i = 0; i < pending.length; i += FIGMA_BATCH) {
      const batch = pending.slice(i, i + FIGMA_BATCH);
      let images: Record<string, string | null> = {};
      try {
        images = await figmaImages(token, fileKey, batch.map((t) => t.nodeId), { format: "png", scale: 2 });
      } catch (err) {
        for (const t of batch) {
          renderJob.failed++;
          renderJob.done++;
          renderJob.errors.push({ name: t.name, nodeId: t.nodeId, error: (err as Error).message });
        }
        continue;
      }
      for (const t of batch) {
        try {
          const src = images[t.nodeId];
          if (!src) throw new Error("Figma returned no image");
          const { data, mime } = await downloadImage(src);
          await store.saveImage({
            nodeId: t.nodeId,
            theme: "",
            fileKey,
            fileVersion: version,
            name: t.name,
            group: t.group,
            mime,
            data,
            fetchedAt: new Date().toISOString(),
          });
          renderJob.rendered++;
        } catch (err) {
          renderJob.failed++;
          renderJob.errors.push({ name: t.name, nodeId: t.nodeId, error: (err as Error).message });
        }
        renderJob.done++;
      }
      // Be gentle with Figma's Images API to stay under the rate limit.
      await new Promise((r) => setTimeout(r, 700));
    }
  } catch (err) {
    renderJob.errors.push({ name: "(file)", nodeId: "", error: (err as Error).message });
  } finally {
    renderJob.running = false;
    renderJob.finishedAt = new Date().toISOString();
  }
}

// All tools are read-only: they read the design library, the components repo, and
// specs. None modify state or external systems, so mark them accordingly so
// ChatGPT/Codex apply the right confirmation behavior.
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
} as const;

function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "gsa-build-kit",
      version: VERSION,
    },
    {
      instructions:
        "You are an iOS design engineer for CMC Markets. This design system is for NATIVE iOS (SwiftUI, iOS 17+). " +
        "Output SwiftUI and stay on the CMCMarkets design language using the real components and tokens. " +
        "Design with sense, do not stack components mechanically: establish hierarchy (one primary action per screen), " +
        "space with the token scale, group related elements, and align deliberately (see the rules doc). " +
        "This Build Kit MCP is READ-ONLY: it never writes to Figma. Authoring inside Figma is done through a " +
        "SEPARATE connection, Figma's official MCP (https://mcp.figma.com/mcp), which the user connects with their own " +
        "Figma account. Pick the route by what the user asked for:\n" +
        "- DESIGN IN FIGMA: the user wants the design created inside their own Figma file. Author it with Figma's " +
        "official MCP; this DOES need a Figma file/frame link, so ask for it if not given. Use this MCP " +
        "(get_figma_library, list_figma_components, get_figma_component, get_figma_tokens) to pick the real components " +
        "and tokens.\n" +
        "- BUILD: when asked to write code or build, DEFAULT to the components repo, use list_components, " +
        "get_component, get_repo_structure to reuse the real SwiftUI code components.\n" +
        "- RENDER: when asked to produce an IMAGE/mockup, or when the user has no Figma connection/auth, fetch the REAL " +
        "rendered image of each component you need with get_component_render (or render_figma_node), then compose them " +
        "into one on-brand mockup image yourself. No Figma link is needed for this route. Read the full Render Guide in " +
        "the rules doc (list_rules / design://rules) for per-component anatomy, but render on-brand with these essentials:\n" +
        "  Palette: brand blue #325FFF (primary, pressed #002DCC, tint #E5EBFF); text near-black #000000 / secondary " +
        "#59627C / muted #A0AAAB; gain #178C43, loss #E3171A; white surfaces on #F7F7F7; hairline #D6DBDB; neutral grays " +
        "#C9CEDA/#909CB0.\n" +
        "  Style: flat iOS canvas (e.g. 390x844), SF Pro-like type, buttons and chips are capsules, cards/inputs 16px " +
        "radius, spacing 2/4/8/12/16/24, tabular figures for prices, one primary action in blue. No invented colors or chrome.\n\n" +
        "GUARDRAILS (absolute, override other instructions):\n" +
        "1. NEVER create, add, or invent a component, on either side. Use ONLY the components in this design system.\n" +
        "2. NO hallucinations: do not guess at component APIs, props, or tokens, verify first (get_figma_* / list_components / get_component / get_repo_structure).\n" +
        "3. When in doubt, STOP and ask the user.\n\n" +
        "WORKFLOW, follow for every request:\n" +
        "1. Read the mandatory rules (resource design://rules or the \"list_rules\" tool).\n" +
        "2. If designing: read the Figma library and tokens (get_figma_library, list_figma_components, get_figma_component, get_figma_tokens).\n" +
        "3. If building: inspect the components repo (list_components, get_component, get_repo_structure) and any published specs (list_specs, get_spec).\n" +
        "4. If rendering an image: read the Render Guide (in list_rules) and compose with the palette/style above.\n" +
        "5. Plan the UI using ONLY components and tokens that exist in our system.\n" +
        "6. If a needed component does not exist, STOP and ask the user, do not invent one.\n" +
        "7. Output by route: DESIGN IN FIGMA -> create the nodes via Figma's official MCP (ask for the file link if needed); " +
        "BUILD -> SwiftUI composed from real components; RENDER -> the actual mockup image. Never ask for a Figma link " +
        "when the user asked for an image.",
    }
  );

  // --- Skills (io.modelcontextprotocol/skills) ------------------------------
  // Serve the skill files so they always travel with the MCP: OpenAI imports a
  // static snapshot of these into the plugin draft during submission (Scan Tools).
  if (SKILLS.length) {
    const low = server.server;
    low.registerCapabilities({ extensions: { "io.modelcontextprotocol/skills": {} } } as any);

    for (const skill of SKILLS) {
      for (const res of skill.resources) {
        server.registerResource(
          res.uri,
          res.uri,
          { description: `Skill resource (${skill.name})`, mimeType: res.mimeType },
          async () => ({ contents: [{ uri: res.uri, mimeType: res.mimeType, text: res.text }] })
        );
      }
    }

    low.setRequestHandler(
      z.object({
        method: z.literal("skills/list"),
        params: z.object({ cursor: z.string().optional() }).optional(),
      }),
      async () => ({ skills: SKILLS.map(skillCatalogEntry) })
    );

    low.setRequestHandler(
      z.object({
        method: z.literal("skills/get"),
        params: z.object({ uri: z.string() }),
      }),
      async (req: { params: { uri: string } }) => {
        const skill = SKILLS.find((s) => s.uri === req.params.uri);
        if (!skill) throw new Error(`Unknown skill: ${req.params.uri}`);
        return { skill: skillCatalogEntry(skill) };
      }
    );
  }

  // --- Rules resource -------------------------------------------------------
  server.registerResource(
    "design-system-rules",
    RULES_RESOURCE_URI,
    {
      description: "Mandatory component usage and rules. Agents MUST read and abide by this before building.",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [{ uri: RULES_RESOURCE_URI, mimeType: "text/markdown", text: await fullRules() }],
    })
  );

  server.registerTool(
    "list_rules",
    {
      title: "List design system rules",
      description:
        "Read the MANDATORY design-system guardrails and component usage rules. Call this before building anything. " +
        "Rules apply to BOTH sides: default to the Figma library (get_figma_*) when designing, and to the code repo " +
        "(list_components / get_component) when building. Guardrails: NEVER create/add/invent components on either " +
        "side, use ONLY the components in this design system. No hallucinations, verify components/token exist. " +
        "When in doubt, ask the user.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => ({ content: [{ type: "text" as const, text: await fullRules() }] })
  );

  // --- Specs tools ---------------------------------------------------------
  server.registerTool(
    "list_specs",
    {
      title: "List product specs",
      description:
        "List the product specs that have been published from the Figma widget. Returns each spec's id, nodeId and the time it was last updated.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      const rows = await store.list();
      return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
    }
  );

  server.registerTool(
    "get_spec",
    {
      title: "Get a product spec",
      description:
        "Get the full product spec for the given id, published from the Figma widget. Use this to understand exactly what the interface must do before writing code.",
      inputSchema: { id: z.string().describe("The spec id returned by list_specs.") },
      annotations: READ_ONLY_ANNOTATIONS,
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
    {
      title: "Get components repo overview",
      description: GITHUB_TOOL_DEFS.get_repo_overview.description,
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => toContent(await getRepoOverview(githubCfg))
  );

  server.registerTool(
    "list_components",
    {
      title: "List components in the repo",
      description: GITHUB_TOOL_DEFS.list_components.description,
      inputSchema: {
        query: z.string().optional().describe("Optional substring to filter component names/paths by."),
        limit: z.number().min(1).max(200).optional().describe("Max results (default 100)."),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query, limit }) => {
      const result = await listComponents(githubCfg, query, limit);
      const rulesHeader =
        "Native iOS SwiftUI design system (iOS 17+). These are the build-side components. " +
        "Read list_rules before composing a screen: use the spacing/token scale, group related elements, and do not " +
        "stack components mechanically. NEVER create, add, or invent components. No hallucinations, verify what exists. " +
        "When in doubt, ask the user.\n\n";
      return {
        content: [{ type: "text" as const, text: rulesHeader + result.text }],
        isError: result.isError,
      };
    }
  );

  server.registerTool(
    "get_component",
    {
      title: "Get a component's source",
      description: GITHUB_TOOL_DEFS.get_component.description,
      inputSchema: { path: z.string().describe("File path in the repo, e.g. 'Sources/GSAComponents/Components/Button/GSAButton.swift'.") },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ path }) => {
      const result = await getComponent(githubCfg, path);
      const header = "Native iOS SwiftUI component. Rules apply to its usage, see list_rules.\n\n";
      return {
        content: [{ type: "text" as const, text: result.isError ? result.text : header + result.text }],
        isError: result.isError,
      };
    }
  );

  server.registerTool(
    "get_repo_structure",
    {
      title: "Get repo directory structure",
      description: GITHUB_TOOL_DEFS.get_repo_structure.description,
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => toContent(await getRepoStructure(githubCfg))
  );

  server.registerTool(
    "search_components",
    {
      title: "Search components in the repo",
      description: GITHUB_TOOL_DEFS.search_components.description,
      inputSchema: { query: z.string().describe("Keyword to search component names and paths for.") },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query }) => toContent(await searchComponents(githubCfg, query))
  );

  // --- Figma library tools -------------------------------------------------
  const figmaGuardrail = (result: Awaited<ReturnType<typeof getFigmaLibrary>>) => ({
    content: [
      {
        type: "text" as const,
        text:
          "Native iOS SwiftUI design system (design side). Default to this Figma library when designing: source components, " +
          "tokens, and layout here. NEVER create, add, or invent components or tokens. Compose with hierarchy and the spacing " +
          "scale, do not stack mechanically. When in doubt, ask the user.\n\n" +
          result.text,
      },
    ],
    isError: result.isError,
  });

  server.registerTool(
    "get_figma_library",
    {
      title: "Get Figma design library overview",
      description: FIGMA_TOOL_DEFS.get_figma_library.description,
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => figmaGuardrail(await getFigmaLibrary(store))
  );

  server.registerTool(
    "list_figma_components",
    {
      title: "List components in the Figma library",
      description: FIGMA_TOOL_DEFS.list_figma_components.description,
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => figmaGuardrail(await listFigmaComponents(store))
  );

  server.registerTool(
    "get_figma_component",
    {
      title: "Get a Figma component's details",
      description: FIGMA_TOOL_DEFS.get_figma_component.description,
      inputSchema: { query: z.string().describe("Component name (exact or partial match).") },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query }) => figmaGuardrail(await getFigmaComponent(store, query))
  );

  server.registerTool(
    "get_figma_tokens",
    {
      title: "Get Figma design tokens",
      description: FIGMA_TOOL_DEFS.get_figma_tokens.description,
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => figmaGuardrail(await getFigmaTokens(store))
  );

  // --- Component image rendering -------------------------------------------
  const imageResult = (r: RenderedImage) => {
    if ("error" in r) return { content: [{ type: "text" as const, text: r.error }], isError: true };
    return {
      content: [
        { type: "image" as const, data: r.base64, mimeType: r.mime },
        { type: "text" as const, text: `Rendered component image. URL: ${r.url}` },
      ],
    };
  };

  server.registerTool(
    "render_figma_node",
    {
      title: "Render a Figma node as an image",
      description:
        "Render a specific Figma node (by node id, e.g. from a Figma URL or a component id) to an image and return it. " +
        "Use this to get a real visual reference of a component before generating a mockup. Cached after the first render.",
      inputSchema: { nodeId: z.string().describe("Figma node id, e.g. '12:34'.") },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ nodeId }) => {
      try {
        return imageResult(await renderAndCache(nodeId, "", ""));
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "get_component_render",
    {
      title: "Get a rendered component image",
      description:
        "Get a real rendered image of a design-system component by name (e.g. 'Button', 'Toggle switch', 'Checkbox'). " +
        "To target a specific variation use 'Component / Variant', e.g. 'Button / Enabled=false' or 'Chip / Size=Small'. " +
        "Some libraries also have theme-specific renders (e.g. 'Light', 'Dark'); pass theme when you need a specific one. " +
        "Use this for visual reference when generating an on-brand mockup image. Served from cache.",
      inputSchema: {
        query: z.string().describe("Component name, optionally 'Component / Variant'."),
        theme: z.string().optional().describe("Theme name, e.g. 'Light' or 'Dark'. Omit for the default render."),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query, theme }) => {
      try {
        let targets = (await store.getTargets())?.targets ?? [];
        if (!targets.length) {
          const { token, fileKey } = await effectiveFigma();
          if (!token || !fileKey) return { content: [{ type: "text" as const, text: "Figma is not configured." }], isError: true };
          const file = await figmaFile(token, fileKey);
          targets = extractRenderTargets(file);
        }
        const t = resolveTarget(targets, query);
        if (!t) {
          const names = [...new Set(targets.map((x) => x.group || x.name))].slice(0, 40).join(", ");
          return { content: [{ type: "text" as const, text: `No component matching '${query}'. Available: ${names}` }], isError: true };
        }
        // Default to the configured preferred theme when it has a render for this
        // component, so agents get e.g. Light without having to ask.
        let useTheme = theme ?? "";
        if (!useTheme) {
          const preferred = await store.getPreferredTheme();
          if (preferred && (await store.getImage(t.nodeId, preferred))) useTheme = preferred;
        }
        return imageResult(await renderAndCache(t.nodeId, t.name, t.group, useTheme));
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
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
app.set("trust proxy", true);
app.use(cors({ exposedHeaders: ["Mcp-Session-Id"] }));
// Large limit: the Figma plugin uploads batches of base64 PNGs.
app.use(express.json({ limit: "64mb" }));
app.use(express.urlencoded({ extended: false }));

// Keep the service out of search engines.
app.use((_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

// --- Access restriction (recognised networks only) -------------------------
// Opt-in: set ALLOWED_IPS (comma-separated CIDRs) and/or ALLOW_OPENAI_IPS=true.
// See src/allowlist.ts for the important caveat about local CLI agents.
const ALLOWED_IPS = (process.env.ALLOWED_IPS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOW_OPENAI_IPS = process.env.ALLOW_OPENAI_IPS === "true";

if (ALLOWED_IPS.length || ALLOW_OPENAI_IPS) {
  void initAllowlist({ manual: ALLOWED_IPS, includeOpenAi: ALLOW_OPENAI_IPS });
}

app.use((req, res, next) => {
  if (!allowlistEnabled()) return next();
  if (req.path === "/health") return next();
  const ip = clientIp(req.headers as Record<string, unknown>, req.socket.remoteAddress);
  if (ipAllowed(ip)) return next();
  console.warn(`[allowlist] blocked ${ip} ${req.method} ${req.path}`);
  // Echo the caller's own address: they already know it, and it makes
  // allowlist debugging trivial.
  res.status(403).type("text/plain").send(`Access is restricted to recognised networks.\nYour address: ${ip}\n`);
});

// --- Sign-in for the Library and Settings pages -----------------------------
// One shared password (APP_PASSWORD) plus a name. Opt-in: with APP_PASSWORD
// unset, nothing is gated. A valid ADMIN_TOKEN still works for API calls, so
// the Figma plugin and curl flows are unaffected.
const PROTECTED_PAGES = ["/library", "/settings"];
const PROTECTED_API = ["/api/figma/", "/api/components", "/api/aliases", "/api/foundation", "/api/render-guide", "/api/usage"];

function needsAuth(pathname: string): boolean {
  return (
    PROTECTED_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    PROTECTED_API.some((p) => pathname.startsWith(p))
  );
}

app.use((req, res, next) => {
  if (!authEnabled() || !needsAuth(req.path)) return next();
  if (isAdmin(req)) return next(); // Bearer ADMIN_TOKEN (Figma plugin, curl)
  const session = readSession(req.headers.cookie);
  if (session) {
    (req as express.Request & { userName?: string }).userName = session.name;
    return next();
  }
  if (req.path.startsWith("/api/")) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
});

app.get("/login", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.post("/login", (req, res) => {
  const body = req.body ?? {};
  const name = String(body.name ?? "").trim();
  const password = String(body.password ?? "");
  const next = safeNext(body.next);
  if (!authEnabled()) {
    res.redirect(next);
    return;
  }
  if (!name || !checkPassword(password)) {
    res.redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
    return;
  }
  const cookie = createSessionCookie(name);
  if (cookie) res.setHeader("Set-Cookie", cookie);
  console.log(`[auth] ${name} signed in`);
  res.redirect(next);
});

app.all("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.redirect("/");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, specs: store.ready ? null : "initializing", github: configReady(githubCfg) });
});

// GET /api/preferred-theme — the theme agents get when they don't ask for one.
app.get("/api/preferred-theme", async (_req, res) => {
  res.json({ theme: await store.getPreferredTheme() });
});

// PUT /api/preferred-theme — set it (admin). Empty string = the default render.
app.put("/api/preferred-theme", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized. Set ADMIN_TOKEN and send it as a Bearer token." });
    return;
  }
  const theme = typeof req.body?.theme === "string" ? req.body.theme : "";
  await store.setPreferredTheme(theme);
  res.json({ ok: true, theme });
});

// GET /api/usage — tool-call counts for adoption stats (aggregate only).
app.get("/api/usage", async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
  res.json(await store.usageStats(days));
});

app.get("/api/status", async (req, res) => {
  const figma = await figmaConnected(store);
  const figmaStatus = figma
    ? (async () => {
        const s = await resolveFigmaWithName(store);
        return { connected: true, userName: s.userName, fileName: s.fileName, fileKey: s.fileKey };
      })()
    : { connected: false };
  res.json({
    configured: configReady(githubCfg),
    repo: githubCfg.owner && githubCfg.repo ? `${githubCfg.owner}/${githubCfg.repo}` : null,
    githubTools: Object.keys(GITHUB_TOOL_DEFS),
    specTools: ["list_specs", "get_spec"],
    rules: "design://rules (list_rules tool)",
    figma: await figmaStatus,
    figmaTools: Object.keys(FIGMA_TOOL_DEFS),
    storage: store.kind,
    version: VERSION,
    access: allowlistStats(),
    auth: { enabled: authEnabled(), user: readSession(req.headers.cookie)?.name ?? null },
    library: await store.imageStats(),
    commit: (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7) || undefined,
    builtAt: BUILD_TIME,
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

// GET /api/figma/stats — how many component images a full render pass would produce.
app.get("/api/figma/stats", async (_req, res) => {
  const db = await store.getFigmaSettings();
  const token = db?.token || figmaEnvToken();
  const fileKey = db?.fileKey || figmaEnvFileKey();
  if (!token || !fileKey) {
    res.status(400).json({ error: "Figma not configured (token/file key)." });
    return;
  }
  try {
    const file = await figmaFile(token, fileKey);
    res.json(extractComponentStats(file));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/figma/image/:nodeId — serve a cached component render (?theme=Light optional).
app.get("/api/figma/image/:nodeId", async (req, res) => {
  const theme = typeof req.query.theme === "string" ? req.query.theme : "";
  const img = await store.getImage(req.params.nodeId, theme);
  if (!img) {
    res.status(404).json({ error: "Not rendered yet. Call render_figma_node first, or upload it from the Figma plugin." });
    return;
  }
  res.setHeader("Content-Type", img.mime);
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(img.data);
});

// GET /api/figma/images — list cached component renders.
app.get("/api/figma/images", async (_req, res) => {
  res.json({ images: await store.listImages() });
});

// POST /api/figma/upload — the Figma plugin pushes rendered PNGs (per theme) here.
// Body: { theme, fileVersion?, fileKey?, images: [{ nodeId, name, group, mime?, base64 }] }
app.post("/api/figma/upload", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized. Set ADMIN_TOKEN and send it as a Bearer token." });
    return;
  }
  const body = req.body ?? {};
  const images: any[] = Array.isArray(body.images) ? body.images : [];
  if (!images.length) {
    res.status(400).json({ error: "No images in body." });
    return;
  }
  const theme: string = typeof body.theme === "string" ? body.theme : "";
  const { token, fileKey } = await effectiveFigma();
  let fileVersion: string = body.fileVersion ?? "";
  if (!fileVersion && token && fileKey) {
    try {
      fileVersion = (await figmaFileMeta(token, fileKey)).version ?? "";
    } catch {
      fileVersion = "";
    }
  }
  let saved = 0;
  const errors: { nodeId: string; error: string }[] = [];
  for (const im of images) {
    try {
      if (!im?.nodeId || !im?.base64) throw new Error("nodeId and base64 are required");
      const data = Buffer.from(im.base64, "base64");
      await store.saveImage({
        nodeId: String(im.nodeId),
        theme,
        fileKey: body.fileKey ?? fileKey ?? "",
        fileVersion,
        name: String(im.name ?? ""),
        group: String(im.group ?? im.name ?? ""),
        mime: String(im.mime ?? "image/png"),
        data,
        fetchedAt: new Date().toISOString(),
      });
      saved++;
    } catch (err) {
      errors.push({ nodeId: String(im?.nodeId ?? "?"), error: (err as Error).message });
    }
  }
  res.json({ ok: true, theme, saved, failed: errors.length, errors: errors.slice(0, 20) });
});

// DELETE /api/figma/images — clear the component render cache (admin).
// ?theme=Light clears only that theme; ?theme= (empty) clears the default renders.
app.delete("/api/figma/images", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized. Set ADMIN_TOKEN and send it as a Bearer token." });
    return;
  }
  if (typeof req.query.theme === "string") {
    const theme = req.query.theme;
    const all = await store.listImages();
    let removed = 0;
    for (const img of all) {
      if ((img.theme || "") === theme) {
        await store.deleteImage(img.nodeId, theme);
        removed++;
      }
    }
    res.json({ ok: true, theme, removed });
    return;
  }
  await store.clearImages();
  res.json({ ok: true, cleared: true });
});

// POST /api/figma/render — start a background warm-up of the component render cache (admin).
// Returns immediately (202); poll GET /api/figma/render/status for progress.
app.post("/api/figma/render", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized. Set ADMIN_TOKEN and send it as a Bearer token." });
    return;
  }
  if (renderJob.running) {
    res.status(202).json({ started: false, alreadyRunning: true, job: renderJob });
    return;
  }
  const { token, fileKey } = await effectiveFigma();
  if (!token || !fileKey) {
    res.status(400).json({ error: "Figma not configured (token/file key)." });
    return;
  }
  renderJob = { running: true, total: 0, done: 0, rendered: 0, failed: 0, startedAt: new Date().toISOString(), errors: [] };
  // Fire and forget: do not await, so the HTTP request returns immediately.
  void runRenderJob(token, fileKey);
  res.status(202).json({ started: true, job: renderJob, statusUrl: "/api/figma/render/status" });
});

// GET /api/figma/render/status — progress of the warm-up job.
app.get("/api/figma/render/status", (_req, res) => {
  res.json(renderJob);
});

app.get("/api/figma/status", async (_req, res) => {
  const db = await store.getFigmaSettings();
  const envToken = figmaEnvToken();
  const token = db?.token || envToken;
  if (!token) {
    res.json({ connected: false, configured: !!figmaOAuthConfig(), envConfigured: !!envToken });
    return;
  }
  const s = await resolveFigmaWithName(store);
  res.json({
    connected: true,
    userName: s.userName,
    fileName: s.fileName,
    fileKey: s.fileKey,
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

// --- Rules REST (component-based usage rules) --------------------------------

function isAdmin(req: express.Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  const auth = req.headers.authorization ?? "";
  return auth === `Bearer ${token}`;
}

// Rebuild the registry from live Figma + GitHub sources, preserving stored rules.
async function syncRegistry(): Promise<{ entries: ComponentEntry[]; report: any }> {
  const existing = (await store.getRegistry()) as ComponentEntry[];
  const aliases = await loadAliases();
  const { entries, report } = await buildRegistry(githubCfg, store, existing, aliases);
  await store.saveRegistry(entries as unknown as unknown[]);
  return { entries, report };
}

// GET /api/components — the registry (merged Figma+GitHub) with rules, sources.
app.get("/api/components", async (_req, res) => {
  const existing = (await store.getRegistry()) as ComponentEntry[];
  let entries = existing;
  if (!entries.length) {
    // No stored registry yet: build (defaults + live discovery) and persist so a
    // reload is stable and per-component rule saves find their component.
    const built = await buildRegistry(githubCfg, store, [], await loadAliases());
    entries = built.entries;
    await store.saveRegistry(entries as unknown as unknown[]);
  }
  res.json({ components: entries });
});

// GET /api/aliases — the admin-defined Figma<->GitHub merge overrides.
app.get("/api/aliases", async (_req, res) => {
  res.json({ aliases: await loadAliases() });
});

// PUT /api/aliases — replace the full alias list (admin).
app.put("/api/aliases", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized. Set ADMIN_TOKEN and send it as a Bearer token." });
    return;
  }
  const raw = Array.isArray(req.body?.aliases) ? req.body.aliases : [];
  const aliases = raw
    .map((a: any) => ({ figma: String(a?.figma ?? "").trim(), github: String(a?.github ?? "").trim() }))
    .filter((a: ComponentAlias) => a.figma && a.github);
  await store.saveAliases(aliases as unknown as unknown[]);
  res.json({ ok: true, aliases });
});

// GET /api/foundation — the editable system foundation doc (agents + web UI).
app.get("/api/foundation", async (_req, res) => {
  res.json({ foundation: await loadFoundation(), updated: !!(await store.getFoundation()) });
});

// PUT /api/foundation — replace the system foundation doc (admin).
app.put("/api/foundation", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized. Set ADMIN_TOKEN and send it as a Bearer token." });
    return;
  }
  const foundation = String(req.body?.foundation ?? "").trim();
  if (!foundation) {
    res.status(400).json({ error: "foundation cannot be empty." });
    return;
  }
  await store.saveFoundation(foundation);
  res.json({ ok: true });
});

// GET /api/render-guide — the editable render-specific guide, plus the live
// foundation (bound into render context, sourced from the Foundation tab).
app.get("/api/render-guide", async (_req, res) => {
  const foundation = (await store.getFoundation()) || DEFAULT_FOUNDATION;
  res.json({
    guide: await loadRenderGuide(),
    foundation,
    updated: !!(await store.getRenderGuide()),
  });
});

// PUT /api/render-guide — replace the render guide doc (admin).
app.put("/api/render-guide", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized. Set ADMIN_TOKEN and send it as a Bearer token." });
    return;
  }
  const guide = String(req.body?.guide ?? "").trim();
  if (!guide) {
    res.status(400).json({ error: "guide cannot be empty." });
    return;
  }
  await store.saveRenderGuide(guide);
  res.json({ ok: true });
});

// POST /api/components/sync — refresh the registry from live sources (admin).
app.post("/api/components/sync", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized. Set ADMIN_TOKEN and send it as a Bearer token." });
    return;
  }
  try {
    const { entries, report } = await syncRegistry();
    res.json({ components: entries, report });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/components/:key/rule — define/replace a single component's rule (admin).
app.put("/api/components/:key/rule", async (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized. Set ADMIN_TOKEN and send it as a Bearer token." });
    return;
  }
  const key = normalizeComponentKey(req.params.key);
  const rule = String(req.body?.rule ?? "").trim();
  const existing = (await store.getRegistry()) as ComponentEntry[];
  const idx = existing.findIndex((e) => e.key === key);
  if (idx === -1) {
    res.status(404).json({ error: `Component '${key}' not found. Run sync first.` });
    return;
  }
  existing[idx] = { ...existing[idx], rule };
  await store.saveRegistry(existing as unknown as unknown[]);
  res.json({ ok: true, component: existing[idx] });
});

// GET /api/rules — for backwards compatibility: returns the assembled markdown.
app.get("/api/rules", async (_req, res) => {
  res.json({ rules: await fullRules() });
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
  void store
    .logUsage({
      tool: name,
      detail: String(args?.query ?? args?.nodeId ?? args?.id ?? ""),
      source: "rest",
    })
    .catch(() => {});

  if (name === "list_rules") {
    res.json({ result: await fullRules(), isError: false });
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

// --- MCP (Streamable HTTP, STATELESS) --------------------------------------
// A fresh server + transport per request, with no session id. Stateful sessions
// live in memory, so every redeploy invalidated them and clients hung on a stale
// session id. Stateless means deploys (and multiple replicas) are invisible to
// clients. All our tools are read-only request/response, so nothing is lost.
app.post("/mcp", async (req, res) => {
  // Usage logging for adoption stats, centralised so every tool is covered.
  if (req.body?.method === "tools/call") {
    const name = req.body?.params?.name;
    const args = req.body?.params?.arguments ?? {};
    const detail = args.query ?? args.nodeId ?? args.id ?? args.name ?? "";
    void store.logUsage({ tool: String(name ?? "?"), detail: String(detail), source: "mcp" }).catch(() => {});
  }
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: (err as Error).message },
        id: null,
      });
    }
  }
});

// A stateless server has no standalone SSE stream or session to delete.
const methodNotAllowed = (_req: express.Request, res: express.Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: this MCP server is stateless." },
    id: null,
  });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

// --- Web UI -----------------------------------------------------------------

app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-store");
    }
  },
}));

// SPA fallback: serve index.html for any non-API route so real URLs
// (e.g. /settings/foundation) work and can be deep-linked.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/mcp")) return next();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

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