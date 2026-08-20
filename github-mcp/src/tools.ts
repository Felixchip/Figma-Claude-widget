import {
  configReady,
  getFileContent,
  getRepoMeta,
  getRepoTree,
  looksLikeComponentFile,
  type GitHubConfig,
} from "./github.js";

export type ToolResult = { text: string; isError?: boolean };

function componentName(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  return base.replace(/\.[^.]+$/, "");
}

function notConfigured(tool: string): ToolResult {
  return {
    text: `This MCP server is not configured with a components repo. Set GITHUB_REPO (e.g. 'acme/web') or GITHUB_OWNER+GITHUB_REPO_NAME (and optionally GITHUB_TOKEN for private repos) and redeploy. (called from ${tool})`,
    isError: true,
  };
}

function toolError(err: unknown): ToolResult {
  return { text: `Error: ${(err as Error).message}`, isError: true };
}

export async function getRepoOverview(cfg: GitHubConfig): Promise<ToolResult> {
  if (!configReady(cfg)) return notConfigured("get_repo_overview");
  try {
    const meta = await getRepoMeta(cfg);
    return {
      text: JSON.stringify(
        {
          fullName: meta.full_name,
          description: meta.description,
          defaultBranch: meta.default_branch,
          language: meta.language,
          topics: meta.topics ?? [],
          htmlUrl: meta.html_url,
          updatedAt: meta.updated_at,
        },
        null,
        2
      ),
    };
  } catch (err) {
    return toolError(err);
  }
}

export async function listComponents(cfg: GitHubConfig, query?: string, limit?: number): Promise<ToolResult> {
  if (!configReady(cfg)) return notConfigured("list_components");
  try {
    const files = await getRepoTree(cfg);
    const components = files
      .filter((f) => looksLikeComponentFile(f.path))
      .map((f) => ({ name: componentName(f.path), path: f.path }))
      .filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()) || c.path.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit ?? 100);
    return { text: JSON.stringify(components, null, 2) };
  } catch (err) {
    return toolError(err);
  }
}

export async function getComponent(cfg: GitHubConfig, filePath: string): Promise<ToolResult> {
  if (!configReady(cfg)) return notConfigured("get_component");
  try {
    const content = await getFileContent(cfg, filePath);
    if (content === null) {
      return {
        text: `No file found at '${filePath}'. Use list_components to find valid paths.`,
        isError: true,
      };
    }
    return { text: `// ${filePath}\n\n${content}` };
  } catch (err) {
    return toolError(err);
  }
}

export async function getRepoStructure(cfg: GitHubConfig): Promise<ToolResult> {
  if (!configReady(cfg)) return notConfigured("get_repo_structure");
  try {
    const files = await getRepoTree(cfg);
    const dirMap = new Map<string, number>();
    for (const f of files) {
      const parts = f.path.split("/");
      const dir = parts.slice(0, -1).join("/") || "(root)";
      dirMap.set(dir, (dirMap.get(dir) ?? 0) + 1);
    }
    const structure = [...dirMap.entries()]
      .map(([dir, count]) => ({ dir, files: count }))
      .sort((a, b) => a.dir.localeCompare(b.dir));
    return { text: JSON.stringify(structure, null, 2) };
  } catch (err) {
    return toolError(err);
  }
}

export async function searchComponents(cfg: GitHubConfig, query: string): Promise<ToolResult> {
  if (!configReady(cfg)) return notConfigured("search_components");
  try {
    const files = await getRepoTree(cfg);
    const matches = files
      .filter((f) => looksLikeComponentFile(f.path))
      .map((f) => ({ name: componentName(f.path), path: f.path }))
      .filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.path.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, 50);
    return { text: JSON.stringify(matches, null, 2) };
  } catch (err) {
    return toolError(err);
  }
}

export type ToolName =
  | "get_repo_overview"
  | "list_components"
  | "get_component"
  | "get_repo_structure"
  | "search_components";

export const TOOL_DEFS: Record<ToolName, { description: string; needs: "none" | "query" | "path" | "queryOpt" }> = {
  get_repo_overview: { description: "Overview of the configured components repo: name, description, default branch, language, topics.", needs: "none" },
  list_components: { description: "List all component files in the components repo (component name + path).", needs: "queryOpt" },
  get_component: { description: "Get the full source code of a component file by its path in the repo.", needs: "path" },
  get_repo_structure: { description: "High-level directory structure of the repo (dirs with file counts).", needs: "none" },
  search_components: { description: "Search component names/paths by keyword.", needs: "query" },
};

export async function runTool(cfg: GitHubConfig, name: string, args: any): Promise<ToolResult> {
  switch (name) {
    case "get_repo_overview":
      return getRepoOverview(cfg);
    case "list_components":
      return listComponents(cfg, args?.query, args?.limit);
    case "get_component":
      return getComponent(cfg, args?.path ?? "");
    case "get_repo_structure":
      return getRepoStructure(cfg);
    case "search_components":
      return searchComponents(cfg, args?.query ?? "");
    default:
      return { text: `Unknown tool '${name}'`, isError: true };
  }
}