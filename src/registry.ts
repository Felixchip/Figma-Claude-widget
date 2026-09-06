import type { GitHubConfig } from "./github.js";
import { getRepoTree, looksLikeComponentFile } from "./github.js";
import { figmaFile, extractComponents } from "./figma.js";
import type { SpecStore } from "./store.js";

export type ComponentSource =
  | { source: "figma"; name: string; id: string }
  | { source: "github"; name: string; path: string };

export type ComponentEntry = {
  key: string;
  label: string;
  sources: ComponentSource[];
  rule: string;
};

// Normalize a component name to a stable merge key: lowercase, strip a leading
// "gsa" prefix, and drop non-alphanumerics. e.g. "GSAButton" -> "button",
// Figma "Button" -> "button", "GSARangeSlider" -> "rangeslider".
export function normalizeComponentKey(name: string): string {
  let s = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s.startsWith("gsa")) s = s.slice(3);
  return s;
}

export async function discoverGithubComponents(cfg: GitHubConfig): Promise<{ name: string; path: string }[]> {
  if (!cfg.owner || !cfg.repo) return [];
  try {
    const files = await getRepoTree(cfg);
    return files
      .filter((f) => looksLikeComponentFile(f.path))
      .map((f) => ({
        name: f.path.split("/").pop()!.replace(/\.[^.]+$/, ""),
        path: f.path,
      }))
      .filter((c) => !/^package$/.test(c.name.toLowerCase()));
  } catch {
    return [];
  }
}

export async function discoverFigmaComponents(store: SpecStore): Promise<{ name: string; id: string }[]> {
  const s = await store.getFigmaSettings();
  const token = s?.token;
  const fileKey = s?.fileKey;
  if (!token || !fileKey) return [];
  try {
    const file = await figmaFile(token, fileKey);
    return extractComponents(file).map((c) => ({ name: c.name, id: c.componentId }));
  } catch {
    return [];
  }
}

function mergeComponent(label: string, key: string, src: ComponentSource, map: Map<string, ComponentEntry>) {
  const existing = map.get(key);
  if (existing) {
    existing.sources.push(src);
    if (!existing.label) existing.label = label;
  } else {
    map.set(key, { key, label, sources: [src], rule: "" });
  }
}

// Build the canonical component registry from the live sources. Stored rules are
// layered back on by key so previously-entered guidance survives re-syncs.
export async function buildRegistry(cfg: GitHubConfig, store: SpecStore, existing: ComponentEntry[]): Promise<ComponentEntry[]> {
  const map = new Map<string, ComponentEntry>();

  const github = await discoverGithubComponents(cfg);
  for (const c of github) {
    mergeComponent(c.name, normalizeComponentKey(c.name), { source: "github", name: c.name, path: c.path }, map);
  }

  const figma = await discoverFigmaComponents(store);
  for (const c of figma) {
    mergeComponent(c.name, normalizeComponentKey(c.name), { source: "figma", name: c.name, id: c.id }, map);
  }

  // Preserve any existing rules (by key) and prefer the GitHub label when both exist.
  const stored = new Map(existing.map((e) => [e.key, e]));
  for (const [key, entry] of map) {
    const prev = stored.get(key);
    if (prev?.rule) entry.rule = prev.rule;
    const gh = entry.sources.find((s) => s.source === "github");
    if (gh) entry.label = gh.name;
  }

  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// Build the markdown rules doc an agent reads: static preamble + one section per
// component that has a rule defined. Components without a rule are listed in a
// short "not yet documented" line so agents know they exist but have no guidance.
export function rulesToMarkdown(preamble: string, entries: ComponentEntry[]): string {
  const documented = entries.filter((e) => e.rule.trim());
  const undocumented = entries.filter((e) => !e.rule.trim());

  const parts = [preamble];

  if (documented.length) {
    for (const e of documented) {
      const gh = e.sources.find((s) => s.source === "github");
      const fig = e.sources.find((s) => s.source === "figma");
      const refs = [
        fig ? `Figma: ${fig.name}` : null,
        gh ? `GitHub: ${gh.name}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      parts.push(`\n## Component: ${e.label}${refs ? `\n\n_${refs}_` : ""}\n\n${e.rule.trim()}`);
    }
  }

  if (undocumented.length) {
    const names = undocumented.map((e) => e.label).join(", ");
    parts.push(
      `\n## Components without documented rules\n\n` +
        `These components exist but no usage rule is defined yet: ${names}. ` +
        `If you need to use one and have no guidance, ask the user how it should behave.`
    );
  }

  return parts.join("\n");
}