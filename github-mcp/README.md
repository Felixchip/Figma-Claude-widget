# GitHub Components MCP

MCP server that reads a GitHub **code components repo** so AI agents (Claude, DeepSeek, ChatGPT) build with your real components instead of inventing them. Includes a web UI.

## Tools

| Tool | Description |
| ---- | ----------- |
| `get_repo_overview` | Repo name, description, default branch, language, topics |
| `list_components` | List component files (name + path), optional filter |
| `get_component` | Full source of a component file by path |
| `get_repo_structure` | Directory structure with file counts |
| `search_components` | Search component names/paths by keyword |

## Run locally

```sh
npm install
GITHUB_REPO=acme/web npm run build
GITHUB_REPO=acme/web PORT=8080 npm start
```

Open `http://localhost:8080` for the web UI.

## Deploy on Railway

1. Create a new Railway service from the parent repo.
2. Set the service **root directory to `github-mcp/`** (Service Settings → Root Directory). This uses the Dockerfile in this folder.
3. Set env vars:

| Var | Purpose |
| --- | ------- |
| `GITHUB_REPO` | Components repo, e.g. `acme/web` |
| `GITHUB_OWNER` + `GITHUB_REPO_NAME` | Alternative to `GITHUB_REPO` |
| `GITHUB_TOKEN` | Token (required for private repos) |
| `GITHUB_BRANCH` | Branch (default `main`) |

The MCP endpoint is `https://<your-service-url>/mcp`.

## Pair with the Figma MCP

Add both to your agent so it can see the design (Figma) and the components (this server):

```json
{
  "mcpServers": {
    "figma":             { "url": "https://mcp.figma.com/mcp" },
    "github-components": { "url": "https://<your-service-url>/mcp" }
  }
}
```

Suggested prompt:

```
Use the Figma MCP (get_design_context, get_variable_defs) to read the design,
and the github-components MCP to pick components from our repo.
Build the UI reusing our components and tokens. Stay on-brand.
```
