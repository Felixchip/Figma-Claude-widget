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

export function extractVariables(fileVars: any): Record<string, { name: string; values: Record<string, unknown>; type: string }[]> {
  const byType: Record<string, { name: string; values: Record<string, unknown>; type: string }[]> = {};
  const collections = fileVars?.meta?.variableCollections ?? {};
  const variables = fileVars?.meta?.variables ?? {};
  for (const collId of Object.keys(collections)) {
    const coll = collections[collId];
    for (const modeId of Object.keys(coll.variableIds ?? {})) {
      const varId = coll.variableIds[modeId];
      const v = variables[varId];
      if (!v) continue;
      const type = v.resolvedType ?? "unknown";
      (byType[type] ??= []).push({
        name: v.name ?? "untitled",
        type,
        values: v.valuesByMode ?? {},
      });
    }
  }
  return byType;
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