const FIGMA_API = "https://api.figma.com";

export type FigmaOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function figmaOAuthConfig(): FigmaOAuthConfig | null {
  const clientId = process.env.FIGMA_CLIENT_ID;
  const clientSecret = process.env.FIGMA_CLIENT_SECRET;
  const base = process.env.PUBLIC_BASE_URL;
  if (!clientId || !clientSecret || !base) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${base.replace(/\/+$/, "")}/api/figma/oauth/callback`,
  };
}

export function figmaAuthUrl(cfg: FigmaOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: "file_read",
    state,
    response_type: "code",
  });
  return `https://www.figma.com/oauth?${params.toString()}`;
}

export async function exchangeFigmaCode(cfg: FigmaOAuthConfig, code: string): Promise<string> {
  const res = await fetch(`${FIGMA_API}/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      code,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Figma token exchange failed ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function figmaFetch(token: string, path: string, retries = 4): Promise<any> {
  let attempt = 0;
  for (;;) {
    const res = await fetch(`${FIGMA_API}${path}`, {
      headers: { "X-Figma-Token": token },
    });
    if (res.ok) return res.json();
    const body = await res.text();
    const retriable = res.status === 429 || res.status >= 500;
    if (retriable && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(60000, retryAfter * 1000)
        : Math.min(30000, 1500 * 2 ** attempt);
      await sleep(wait);
      attempt++;
      continue;
    }
    throw new Error(`Figma API ${res.status}: ${body.slice(0, 300)}`);
  }
}

export async function figmaMe(token: string) {
  return figmaFetch(token, "/v1/me");
}

export async function figmaFile(token: string, fileKey: string) {
  return figmaFetch(token, `/v1/files/${encodeURIComponent(fileKey)}`);
}

// Lightweight metadata only (depth=1): name, version, lastModified. Much cheaper
// than fetching the whole document, so use it for staleness checks.
export async function figmaFileMeta(token: string, fileKey: string): Promise<{ name?: string; version?: string; lastModified?: string }> {
  return figmaFetch(token, `/v1/files/${encodeURIComponent(fileKey)}?depth=1`);
}

export async function figmaFileVariables(token: string, fileKey: string) {
  return figmaFetch(token, `/v1/files/${encodeURIComponent(fileKey)}/variables/local`);
}

export type ComponentMeta = {
  name: string;
  componentId: string;
  description: string;
};

// Denylist of non-component nodes in the Figma file. We KEEP everything else
// (so new components aren't silently dropped) and only remove clear noise.
export function isNoiseComponent(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (/\[deprecated\]/i.test(n)) return true;
  if (/^[_]/.test(n)) return true;              // hidden nodes
  if (/^[→←↑↓]/.test(n)) return true;           // annotation/pointer nodes
  if (/^Frame \d+/i.test(n)) return true;
  if (/^Component \d+/i.test(n)) return true;
  if (/^placeholder\b/i.test(n)) return true;
  if (/^(page|line|dot)$/i.test(n)) return true;
  if (/^Status bar\b/i.test(n)) return true;    // iOS chrome
  if (/^Home Indicator\b/i.test(n)) return true;
  return false;
}

export type RenderTarget = {
  name: string;
  nodeId: string;
  group: string;
  kind: "set" | "variant" | "component";
};

// Pick which nodes to render. We keep EVERY non-noise component/set (denylist,
// not allowlist) so nothing is dropped, and render EVERY variation:
// - a component set expands to one image per variant (clean single examples,
//   not a messy grid)
// - standalone components render as-is
// Dedupes by name (preferring sets) so duplicate nodes across pages don't render
// repeatedly.
export function extractRenderTargets(fileData: any): RenderTarget[] {
  const docs = fileData.document?.children ?? [];

  // Collect by name, preferring a component set over a standalone component.
  const byName = new Map<string, { name: string; id: string; type: "SET" | "COMPONENT"; kids: any[] }>();
  function collect(node: any) {
    if (!node || typeof node !== "object") return;
    const name: string = node.name ?? "";
    const key = name.trim().toLowerCase();
    if (node.type === "COMPONENT_SET") {
      if (!isNoiseComponent(name)) {
        const kids = Array.isArray(node.children) ? node.children.filter((c: any) => c.type === "COMPONENT") : [];
        byName.set(key, { name, id: node.id, type: "SET", kids });
      }
      return;
    }
    if (node.type === "COMPONENT") {
      if (!isNoiseComponent(name) && !byName.has(key)) {
        byName.set(key, { name, id: node.id, type: "COMPONENT", kids: [] });
      }
      return;
    }
    const children = node.children ?? node.frames;
    if (Array.isArray(children)) for (const c of children) collect(c);
  }
  for (const c of docs) collect(c);

  const targets: RenderTarget[] = [];
  for (const entry of byName.values()) {
    if (entry.type === "COMPONENT") {
      targets.push({ name: entry.name, nodeId: entry.id, group: entry.name, kind: "component" });
      continue;
    }
    if (!entry.kids.length) {
      targets.push({ name: entry.name, nodeId: entry.id, group: entry.name, kind: "set" });
      continue;
    }
    for (const k of entry.kids) {
      targets.push({ name: k.name ?? entry.name, nodeId: k.id, group: entry.name, kind: "variant" });
    }
  }
  return targets;
}

// Render nodes to images via the Figma Images API. Returns { nodeId: url }.
// The returned URLs are temporary (S3); callers should fetch and cache them.
export async function figmaImages(
  token: string,
  fileKey: string,
  nodeIds: string[],
  opts: { format?: "png" | "jpg" | "svg"; scale?: number } = {}
): Promise<Record<string, string>> {
  const format = opts.format ?? "png";
  const scale = opts.scale ?? 2;
  const params = new URLSearchParams({
    ids: nodeIds.join(","),
    format,
    scale: String(scale),
  });
  const data = await figmaFetch(
    token,
    `/v1/images/${encodeURIComponent(fileKey)}?${params.toString()}`
  );
  return (data.images ?? {}) as Record<string, string>;
}

export async function downloadImage(url: string): Promise<{ data: Buffer; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image download failed ${res.status}`);
  const mime = res.headers.get("content-type") ?? "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return { data: buf, mime };
}

export function extractComponents(fileData: any): ComponentMeta[] {
  const docs = fileData.document?.children ?? [];
  const out: ComponentMeta[] = [];
  function walk(node: any) {
    if (!node || typeof node !== "object") return;
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      out.push({
        name: node.name ?? "untitled",
        componentId: node.id ?? "",
        description: node.description ?? "",
      });
      return;
    }
    const children = node.children ?? node.frames;
    if (Array.isArray(children)) for (const c of children) walk(c);
  }
  for (const c of docs) walk(c);
  return out;
}

// Resolve a human query to a render target. Supports:
//   "Button"                 -> a representative Button variant
//   "Button / Enabled=false" -> that specific variant
//   "Button:Enabled=false"   -> same
export function resolveTarget(targets: RenderTarget[], query: string): RenderTarget | undefined {
  const raw = query.trim().toLowerCase();
  if (!raw) return undefined;
  const representative = (list: RenderTarget[]) =>
    list.find((t) => /(enabled|state|status)=(true|default|on|selected)/.test(t.name.toLowerCase())) || list[0];

  const [gRaw, vRaw] = raw.split(/\s*[/:]\s*/);
  if (vRaw) {
    const groupExact = targets.filter((t) => t.group.toLowerCase() === gRaw);
    const scope = groupExact.length ? groupExact : targets.filter((t) => t.group.toLowerCase().includes(gRaw));
    const pool = scope.length ? scope : targets;
    return (
      pool.find((t) => t.name.toLowerCase() === vRaw) ||
      pool.find((t) => t.name.toLowerCase().includes(vRaw)) ||
      pool.find((t) => t.name.toLowerCase().replace(/\s/g, "").includes(vRaw.replace(/\s/g, "")))
    );
  }
  const exactName = targets.find((t) => t.name.toLowerCase() === raw);
  if (exactName) return exactName;
  const groupExact = targets.filter((t) => t.group.toLowerCase() === raw);
  if (groupExact.length) return representative(groupExact);
  const groupContains = targets.filter((t) => t.group.toLowerCase().includes(raw));
  if (groupContains.length) return representative(groupContains);
  return targets.find((t) => t.name.toLowerCase().includes(raw));
}

export type ComponentStats = {
  componentSets: number;
  standaloneComponents: number;
  totalComponents: number;
  variants: number;
  breakdown: { name: string; type: "SET" | "COMPONENT"; variants: number }[];
};

// Count what a "render everything" pass would produce. A COMPONENT_SET renders as
// one image (its variants together); each variant inside it is also a node that
// could be rendered separately.
export function extractComponentStats(fileData: any): ComponentStats {
  const docs = fileData.document?.children ?? [];
  // Dedupe by name, preferring a component set (it carries the variants).
  const byName = new Map<string, { name: string; type: "SET" | "COMPONENT"; variants: number }>();

  function walk(node: any) {
    if (!node || typeof node !== "object") return;
    const name: string = node.name ?? "untitled";
    const key = name.trim().toLowerCase();
    if (node.type === "COMPONENT_SET") {
      if (!isNoiseComponent(name)) {
        const kids = Array.isArray(node.children) ? node.children : [];
        byName.set(key, { name, type: "SET", variants: kids.length });
      }
      return;
    }
    if (node.type === "COMPONENT") {
      if (!isNoiseComponent(name) && !byName.has(key)) {
        byName.set(key, { name, type: "COMPONENT", variants: 0 });
      }
      return;
    }
    const children = node.children ?? node.frames;
    if (Array.isArray(children)) for (const c of children) walk(c);
  }
  for (const c of docs) walk(c);

  const breakdown = [...byName.values()];
  const componentSets = breakdown.filter((b) => b.type === "SET").length;
  const standaloneComponents = breakdown.filter((b) => b.type === "COMPONENT").length;
  const variants = breakdown.reduce((n, b) => n + b.variants, 0);

  return {
    componentSets,
    standaloneComponents,
    totalComponents: componentSets + standaloneComponents,
    variants,
    breakdown,
  };
}

// Turn the Figma variables payload into a compact, *resolved* token list.
//
// The raw payload is unusable: ~215KB of JSON whose values are alias references
// keyed by mode id. Aliases have to be followed to a literal, and modes named,
// or an agent has no real values and invents colours.
export function extractVariables(fileVars: any): string {
  const collections = fileVars?.meta?.variableCollections ?? {};
  const variables = fileVars?.meta?.variables ?? {};

  // modeId -> mode name, and the default mode per collection.
  const modeName = new Map<string, string>();
  const defaultMode = new Map<string, string>(); // collectionId -> modeId
  for (const id of Object.keys(collections)) {
    const c = collections[id];
    for (const m of c.modes ?? []) modeName.set(m.modeId, m.name);
    if (c.defaultModeId) defaultMode.set(id, c.defaultModeId);
  }

  // Follow VARIABLE_ALIAS references to a literal value.
  function resolve(varId: string, modeId: string, depth = 0): any {
    if (depth > 12) return undefined;
    const v = variables[varId];
    if (!v) return undefined;
    let raw = v.valuesByMode?.[modeId];
    if (raw === undefined) {
      const fallback = defaultMode.get(v.variableCollectionId);
      if (fallback) raw = v.valuesByMode?.[fallback];
    }
    if (raw && typeof raw === "object" && raw.type === "VARIABLE_ALIAS") {
      return resolve(raw.id, modeId, depth + 1);
    }
    return raw;
  }

  function toHex(c: any): string | null {
    if (!c || typeof c !== "object" || typeof c.r !== "number") return null;
    const h = (n: number) =>
      Math.round(Math.max(0, Math.min(1, n)) * 255)
        .toString(16)
        .padStart(2, "0");
    const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase();
    return typeof c.a === "number" && c.a < 0.999 ? `${base} (${Math.round(c.a * 100)}%)` : base;
  }

  function format(v: any): string {
    if (v === undefined || v === null) return "—";
    if (typeof v === "number") return String(v);
    if (typeof v === "string") return v;
    const hex = toHex(v);
    return hex ?? JSON.stringify(v);
  }

  // Every mode we know about, in a stable order (Light first if present).
  const allModes = [...new Set(modeName.values())].sort((a, b) =>
    a.toLowerCase() === "light" ? -1 : b.toLowerCase() === "light" ? 1 : a.localeCompare(b)
  );

  const byType: Record<string, string[]> = { COLOR: [], FLOAT: [], STRING: [], other: [] };
  const seen = new Set<string>();

  for (const id of Object.keys(variables)) {
    const v = variables[id];
    if (!v?.name || seen.has(v.name)) continue;
    seen.add(v.name);
    const type = v.resolvedType === "COLOR" ? "COLOR" : v.resolvedType === "FLOAT" ? "FLOAT" : v.resolvedType === "STRING" ? "STRING" : "other";

    // Render only the modes of this token's own collection: a token in the
    // Light/Dark theme should not gain a spurious column from another
    // collection's modes.
    const ownModes: { id: string; name: string }[] = (collections[v.variableCollectionId]?.modes ?? []).map(
      (m: any) => ({ id: String(m.modeId), name: String(m.name) })
    );
    const modes: { id: string; name: string }[] = ownModes.length
      ? ownModes
      : allModes.map((name) => ({ id: "", name }));

    const perMode = modes
      .map((m) => ({ name: m.name, value: format(resolve(id, m.id)) }))
      .filter((p) => p.value !== "—");

    const distinct = [...new Set(perMode.map((p) => p.value))];
    const rendered =
      distinct.length <= 1
        ? (distinct[0] ?? "—")
        : perMode.map((p) => `${p.name}=${p.value}`).join(" · ");

    byType[type].push(`${v.name} = ${rendered}`);
  }

  const collectionList = [...new Set(Object.values<any>(collections).map((c) => String(c.name)))]
    .sort((a, b) => a.localeCompare(b))
    .join(" · ");

  const lines: string[] = [
    "# Design tokens (from the connected Figma library)",
    "",
    "These are the ONLY token names and values that exist. Do not invent a token name, and do not use a colour that is not listed here. If you need one that isn't present, ask the user.",
    "",
    `Collections: ${collectionList || "—"}`,
    "",
  ];

  const titles: Record<string, string> = {
    COLOR: "Colour",
    FLOAT: "Number (spacing, radius, size)",
    STRING: "Text / other",
    other: "Other",
  };
  for (const type of ["COLOR", "FLOAT", "STRING", "other"]) {
    const rows = byType[type];
    if (!rows.length) continue;
    lines.push(`## ${titles[type]} (${rows.length})`, "", ...rows.sort(), "");
  }

  return lines.join("\n");
}

export function fileKeyFromUrl(url: string): string | null {
  const m = url.match(/figma\.com\/(?:file|design)\/([^/?#]+)/);
  return m ? m[1] : null;
}

export function figmaEnvToken(): string | undefined {
  return process.env.FIGMA_PAT || process.env.FIGMA_TOKEN || undefined;
}

export function figmaEnvFileKey(): string | undefined {
  return process.env.FIGMA_FILE_KEY || undefined;
}