import type { SpecStore } from "./store.js";
import {
  extractComponents,
  extractVariables,
  figmaFile,
  figmaFileVariables,
  figmaMe,
  figmaEnvToken,
  figmaEnvFileKey,
} from "./figma.js";

export type ToolResult = { text: string; isError?: boolean };

async function resolveFigma(store: SpecStore) {
  const db = await store.getFigmaSettings();
  const envToken = figmaEnvToken();
  const token = db?.token || envToken;
  const fileKey = db?.fileKey || figmaEnvFileKey() || "";
  return {
    token: token || "",
    fileKey,
    userName: db?.userName || (envToken ? "FIGMA_PAT (env)" : ""),
    fileName: db?.fileName || "",
  };
}

export async function getFigmaLibrary(store: SpecStore): Promise<ToolResult> {
  const s = await resolveFigma(store);
  if (!s.token) return { text: "Figma is not connected. Ask an admin to connect it in the CMC Build Kit web UI.", isError: true };
  if (!s.fileKey) return { text: "Figma is connected but no library file is selected. Ask an admin to pick a file.", isError: true };
  try {
    const file = await figmaFile(s.token, s.fileKey);
    return {
      text: JSON.stringify(
        {
          fileName: file.name,
          fileKey: s.fileKey,
          lastModified: file.lastModified,
          version: file.version,
          pages: (file.document?.children ?? []).map((p: any) => ({ name: p.name, id: p.id })),
          connectedAs: s.userName,
        },
        null,
        2
      ),
    };
  } catch (err) {
    return { text: `Error: ${(err as Error).message}`, isError: true };
  }
}

export async function listFigmaComponents(store: SpecStore): Promise<ToolResult> {
  const s = await resolveFigma(store);
  if (!s.token || !s.fileKey) return { text: "Figma is not connected or no library file selected.", isError: true };
  try {
    const file = await figmaFile(s.token, s.fileKey);
    const comps = extractComponents(file);
    return { text: JSON.stringify(comps, null, 2) };
  } catch (err) {
    return { text: `Error: ${(err as Error).message}`, isError: true };
  }
}

export async function getFigmaComponent(store: SpecStore, query: string): Promise<ToolResult> {
  const s = await resolveFigma(store);
  if (!s.token || !s.fileKey) return { text: "Figma is not connected or no library file selected.", isError: true };
  try {
    const file = await figmaFile(s.token, s.fileKey);
    const comps = extractComponents(file);
    const q = query.toLowerCase();
    const match = comps.find((c) => c.name.toLowerCase() === q) ?? comps.find((c) => c.name.toLowerCase().includes(q));
    if (!match) {
      const names = comps.map((c) => c.name).slice(0, 50);
      return { text: `No component matching '${query}'. Available: ${names.join(", ")}`, isError: true };
    }
    return { text: JSON.stringify(match, null, 2) };
  } catch (err) {
    return { text: `Error: ${(err as Error).message}`, isError: true };
  }
}

export async function getFigmaTokens(store: SpecStore): Promise<ToolResult> {
  const s = await resolveFigma(store);
  if (!s.token || !s.fileKey) return { text: "Figma is not connected or no library file selected.", isError: true };
  try {
    const vars = await figmaFileVariables(s.token, s.fileKey);
    const byType = extractVariables(vars);
    return { text: JSON.stringify(byType, null, 2) };
  } catch (err) {
    return { text: `Error: ${(err as Error).message}`, isError: true };
  }
}

export async function figmaConnected(store: SpecStore): Promise<boolean> {
  const s = await resolveFigma(store);
  return !!(s.token && s.fileKey);
}

export async function figmaStatus(store: SpecStore): Promise<{ connected: boolean; userName?: string; fileName?: string }> {
  const s = await resolveFigma(store);
  if (!s.token) return { connected: false };
  return { connected: true, userName: s.userName, fileName: s.fileName };
}

export async function verifyFigmaConnection(store: SpecStore): Promise<ToolResult> {
  const s = await resolveFigma(store);
  if (!s.token) return { text: "Figma is not connected.", isError: true };
  try {
    const me = await figmaMe(s.token);
    return { text: JSON.stringify({ handle: me.handle, email: me.email }, null, 2) };
  } catch (err) {
    return { text: `Error: ${(err as Error).message}`, isError: true };
  }
}

export const FIGMA_TOOL_DEFS: Record<string, { description: string }> = {
  get_figma_library: { description: "Overview of the connected Figma design library: file name, pages, last modified." },
  list_figma_components: { description: "List all components in the connected Figma design library (name + id + description)." },
  get_figma_component: { description: "Get details of one component in the Figma library by exact name or partial match." },
  get_figma_tokens: { description: "Get the design tokens/variables (colors, spacing, radius, typography) from the connected Figma library." },
};