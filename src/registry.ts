import type { GitHubConfig } from "./github.js";
import { getRepoTree, looksLikeComponentFile } from "./github.js";
import { figmaFile, extractComponents, figmaEnvToken, figmaEnvFileKey } from "./figma.js";
import type { SpecStore } from "./store.js";

export type ComponentAlias = { figma: string; github: string };

export type ComponentSource =
  | { source: "figma"; name: string; id: string }
  | { source: "github"; name: string; path: string };

export type ComponentEntry = {
  key: string;
  label: string;
  sources: ComponentSource[];
  rule: string;
};

// Tokens that describe a component's container/kind and are commonly appended or
// dropped inconsistently between Figma and code ("Toggle" vs "Toggle switch",
// "Navigation bar" vs "NavBar"). Removing them lets those names unify.
const KIND_STOPWORDS = [
  "switch",
  "control",
  "component",
  "element",
  "container",
  "icon",
  "button",
  "bar",
  "view",
  "item",
  "group",
];

// Normalize a component name to a stable merge key: lowercase, strip a leading
// "gsa" prefix, drop non-alphanumerics, then strip trailing kind-qualifiers
// (e.g. "Toggle switch" -> "toggle"). A qualifier is only removed when a
// meaningful stem remains, so single-word names like "Button" survive.
export function normalizeComponentKey(name: string): string {
  let s = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s.startsWith("gsa")) s = s.slice(3);

  for (const w of KIND_STOPWORDS) {
    if (s.endsWith(w) && s.length - w.length >= 3) {
      s = s.slice(0, -w.length);
      break; // only strip one trailing qualifier
    }
  }

  // Drop a trailing plural "s" (but not for words like "status"/"news").
  if (s.endsWith("s") && !s.endsWith("ss") && s.length > 3) {
    s = s.slice(0, -1);
  }

  return s;
}

export type SyncReport = {
  githubCount: number;
  figmaCount: number;
  githubError?: string;
  figmaError?: string;
  figmaTokenConfigured: boolean;
  figmaFileConfigured: boolean;
};

// True GSA UI components live under Sources/GSAComponents/Components/. Exclude
// tokens, examples, previews, and derivative/support files (styles, support
// helpers, presentation helpers) so the rules list is the real component set.
function isRealGsaComponent(path: string, name: string): boolean {
  if (!/Sources\/GSAComponents\/Components\//.test(path)) return false;
  if (/^GSA/i.test(name)) {
    if (/(Style|Support|Presentation|Previews)$/.test(name)) return false;
  }
  return true;
}

export async function discoverGithubComponents(cfg: GitHubConfig): Promise<{ name: string; path: string }[]> {
  if (!cfg.owner || !cfg.repo) return [];
  const files = await getRepoTree(cfg);
  return files
    .filter((f) => looksLikeComponentFile(f.path))
    .map((f) => ({
      name: f.path.split("/").pop()!.replace(/\.[^.]+$/, ""),
      path: f.path,
    }))
    .filter((c) => isRealGsaComponent(c.path, c.name));
}

export async function discoverFigmaComponents(store: SpecStore): Promise<{ name: string; id: string }[]> {
  // Resolve the effective Figma config: web-UI/OAuth settings first, then env vars.
  const db = await store.getFigmaSettings();
  const token = db?.token || figmaEnvToken();
  const fileKey = db?.fileKey || figmaEnvFileKey();
  if (!token || !fileKey) return [];
  const file = await figmaFile(token, fileKey);
  return extractComponents(file).map((c) => ({ name: c.name, id: c.componentId }));
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
// `aliases` lets the admin force a Figma name to share the entry of a GitHub name
// (e.g. "Toggle switch" -> "GSA Toggle") when the heuristic does not merge them.
export async function buildRegistry(
  cfg: GitHubConfig,
  store: SpecStore,
  existing: ComponentEntry[],
  aliases: ComponentAlias[] = []
): Promise<{ entries: ComponentEntry[]; report: SyncReport }> {
  const map = new Map<string, ComponentEntry>();
  const report: SyncReport = {
    githubCount: 0,
    figmaCount: 0,
    figmaTokenConfigured: !!(figmaEnvToken() || (await store.getFigmaSettings())?.token),
    figmaFileConfigured: !!(figmaEnvFileKey() || (await store.getFigmaSettings())?.fileKey),
  };

  // Build alias lookup: figma display name -> canonical key to merge into.
  const aliasToKey = new Map<string, string>();
  for (const a of aliases) {
    if (a.figma.trim() && a.github.trim()) {
      aliasToKey.set(normalizeComponentKey(a.figma.trim()), normalizeComponentKey(a.github.trim()));
    }
  }
  const keyFor = (name: string, source: "figma" | "github") => {
    const k = normalizeComponentKey(name);
    if (source === "figma" && aliasToKey.has(k)) return aliasToKey.get(k)!;
    return k;
  };

  try {
    const github = await discoverGithubComponents(cfg);
    report.githubCount = github.length;
    for (const c of github) {
      mergeComponent(c.name, keyFor(c.name, "github"), { source: "github", name: c.name, path: c.path }, map);
    }
  } catch (err) {
    report.githubError = (err as Error).message;
  }

  // Figma-only: only attach a Figma source when its key maps onto a component
  // already found in the code repo (direct match or via an alias). This drops the
  // raw Figma nodes (status bars, frames, "page", etc.) that have no code component.
  try {
    const figma = await discoverFigmaComponents(store);
    report.figmaCount = figma.length;
    for (const c of figma) {
      const k = keyFor(c.name, "figma");
      if (map.has(k)) {
        mergeComponent(c.name, k, { source: "figma", name: c.name, id: c.id }, map);
      }
    }
  } catch (err) {
    report.figmaError = (err as Error).message;
  }

  // Preserve any existing rules (by key) and prefer the GitHub label when both exist.
  const stored = new Map(existing.map((e) => [e.key, e]));
  for (const [key, entry] of map) {
    const prev = stored.get(key);
    if (prev?.rule) entry.rule = prev.rule;
    const gh = entry.sources.find((s) => s.source === "github");
    if (gh) entry.label = gh.name;
  }

  const entries = [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  return { entries, report };
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