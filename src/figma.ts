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