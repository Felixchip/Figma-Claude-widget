const GITHUB_API = "https://api.github.com";

export type GitHubConfig = {
  owner: string;
  repo: string;
  token: string | undefined;
  defaultBranch: string;
};

export function loadConfig(): GitHubConfig {
  const full = process.env.GITHUB_REPO;
  let owner = process.env.GITHUB_OWNER ?? "";
  let repo = process.env.GITHUB_REPO_NAME ?? "";
  if (full && full.includes("/")) {
    const parts = full.split("/");
    owner = parts[0];
    repo = parts[1];
  }
  return {
    owner,
    repo,
    token: process.env.GITHUB_TOKEN,
    defaultBranch: process.env.GITHUB_BRANCH ?? "main",
  };
}

export function configReady(cfg: GitHubConfig): boolean {
  return !!(cfg.owner && cfg.repo);
}

async function gh(path: string, cfg: GitHubConfig, init?: RequestInit): Promise<any> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-components-mcp",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  const res = await fetch(`${GITHUB_API}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export type TreeEntry = {
  path: string;
  type: "blob" | "tree";
  mode: string;
};

export async function getRepoTree(cfg: GitHubConfig, recursive = true): Promise<TreeEntry[]> {
  const branch = cfg.defaultBranch;
  const data = await gh(`/repos/${cfg.owner}/${cfg.repo}/git/trees/${branch}?recursive=${recursive ? 1 : 0}`, cfg);
  return (data.tree as TreeEntry[]).filter((t) => t.type === "blob");
}

export async function getFileContent(cfg: GitHubConfig, path: string): Promise<string | null> {
  try {
    const data = await gh(`/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(path)}?ref=${cfg.defaultBranch}`, cfg);
    if (data && typeof data.content === "string") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return null;
  } catch {
    return null;
  }
}

export async function getRepoMeta(cfg: GitHubConfig) {
  return gh(`/repos/${cfg.owner}/${cfg.repo}`, cfg);
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

const COMPONENT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".vue", ".svelte", ".mjs", ".cjs", ".astro", ".swift"];
const COMPONENT_DIR_HINTS = ["components", "ui", "src"];
const DESIGN_FILE_EXTENSIONS = [".json", ".md", ".mdx", ".yaml", ".yml", ".css", ".scss", ".less"];

export function looksLikeComponentFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (path.startsWith("node_modules/") || path.includes(".test.") || path.includes(".stories.") || path.includes(".spec.")) return false;
  if (/\.(d\.ts|config|mock|fixture|lock)/.test(lower)) return false;
  // Swift preview scaffolding, not the component itself
  if (/\+previews\.swift$/.test(lower)) return false;
  if (COMPONENT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  // Design-system files: JSON/MDX/tokens living under a components/ui/src dir
  if (DESIGN_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext)) && isComponentDir(lower)) return true;
  return false;
}

export function isComponentDir(path: string): boolean {
  return COMPONENT_DIR_HINTS.some((hint) => path.split("/").includes(hint));
}