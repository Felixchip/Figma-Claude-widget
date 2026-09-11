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

async function figmaFetch(token: string, path: string): Promise<any> {
  const res = await fetch(`${FIGMA_API}${path}`, {
    headers: { "X-Figma-Token": token },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Figma API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function figmaMe(token: string) {
  return figmaFetch(token, "/v1/me");
}

export async function figmaFile(token: string, fileKey: string) {
  return figmaFetch(token, `/v1/files/${encodeURIComponent(fileKey)}`);
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
// not allowlist) so new components aren't dropped:
// - small sets (<= maxSetVariants) render as one set image (all variants together)
// - large sets render up to maxVariantsPerSet representative variants
// - Flags render every flag individually
// Standalone components render as-is. Dedupes by node id.
export function extractRenderTargets(
  fileData: any,
  opts: { maxSetVariants?: number; maxVariantsPerSet?: number } = {}
): RenderTarget[] {
  const maxSetVariants = opts.maxSetVariants ?? 40;
  const maxVariantsPerSet = opts.maxVariantsPerSet ?? 6;
  const docs = fileData.document?.children ?? [];
  const seen = new Set<string>();
  const targets: RenderTarget[] = [];

  function add(name: string, nodeId: string, group: string, kind: RenderTarget["kind"]) {
    if (!nodeId || seen.has(nodeId)) return;
    seen.add(nodeId);
    targets.push({ name, nodeId, group, kind });
  }

  function walk(node: any) {
    if (!node || typeof node !== "object") return;
    const name: string = node.name ?? "";
    if (node.type === "COMPONENT_SET") {
      if (!isNoiseComponent(name)) {
        const kids: any[] = Array.isArray(node.children) ? node.children.filter((c: any) => c.type === "COMPONENT") : [];
        if (name === "Flags") {
          // Each flag is a variant; render them all.
          for (const k of kids) add(k.name ?? "flag", k.id, name, "variant");
        } else if (kids.length <= maxSetVariants) {
          add(name, node.id, name, "set");
        } else {
          for (const k of kids.slice(0, maxVariantsPerSet)) add(`${name} — ${k.name}`, k.id, name, "variant");
        }
      }
      return;
    }
    if (node.type === "COMPONENT") {
      if (!isNoiseComponent(name)) add(name, node.id, name, "component");
      return;
    }
    const children = node.children ?? node.frames;
    if (Array.isArray(children)) for (const c of children) walk(c);
  }
  for (const c of docs) walk(c);
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
  const breakdown: ComponentStats["breakdown"] = [];
  const seen = new Set<string>();
  let componentSets = 0;
  let standaloneComponents = 0;
  let variants = 0;

  function walk(node: any) {
    if (!node || typeof node !== "object") return;
    const name: string = node.name ?? "untitled";
    if (node.type === "COMPONENT_SET") {
      if (seen.has(node.id) || isNoiseComponent(name)) return;
      seen.add(node.id);
      componentSets++;
      const kids = Array.isArray(node.children) ? node.children : [];
      variants += kids.length;
      breakdown.push({ name, type: "SET", variants: kids.length });
      return;
    }
    if (node.type === "COMPONENT") {
      if (seen.has(node.id) || isNoiseComponent(name)) return;
      seen.add(node.id);
      standaloneComponents++;
      breakdown.push({ name, type: "COMPONENT", variants: 0 });
      return;
    }
    const children = node.children ?? node.frames;
    if (Array.isArray(children)) for (const c of children) walk(c);
  }
  for (const c of docs) walk(c);

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