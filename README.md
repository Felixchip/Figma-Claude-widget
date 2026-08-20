# Figma Product Spec Widget + MCP Server

Two related but separate pieces:

1. **Specs MCP** (repo root) — a Figma/FigJam widget that captures a **product spec** for a design and publishes it to an MCP server agents can read.
2. **GitHub Components MCP** (`github-mcp/`) — a separate MCP server that reads your code components repo so agents build with the right components, plus a web UI.

## Specs MCP (repo root)

A Figma/FigJam widget that captures a **product spec** for a design (frame/section) and publishes it to an MCP server. Coding agents (Claude, DeepSeek, ChatGPT) connected to that MCP server can then read the spec — including the Figma **Node ID** — and build the interface against your existing components repo.

## GitHub Components MCP (`github-mcp/`)

A separate MCP server + web UI that connects your agents to the **code components repo** on GitHub:

- MCP endpoint: `/mcp` (Streamable HTTP)
- Tools: `get_repo_overview`, `list_components`, `get_component`, `get_repo_structure`, `search_components`
- Web UI at the service root: landing, setup guides (Figma MCP + this one), playground, brainstorm prompt generator

Config (env vars):

| Var | Purpose |
| --- | ------- |
| `GITHUB_REPO` | Components repo, e.g. `acme/web` |
| `GITHUB_OWNER` / `GITHUB_REPO_NAME` | Alternative to `GITHUB_REPO` |
| `GITHUB_TOKEN` | Token (needed for private repos) |
| `GITHUB_BRANCH` | Branch to read (default `main`) |

To deploy: create a new Railway service from this repo, set the **root directory to `github-mcp/`** (dashboard), which uses the Dockerfile in that folder. Set the env vars above.

To connect your agent, add **two** MCP servers:
- Figma (official): `https://mcp.figma.com/mcp`
- GitHub components: `https://<your-github-mcp-url>/mcp`

## Spec fields (widget)

- Node ID (auto-detected from the attached node)
- Purpose
- Actions / Interactions
- States
- Rules
- Data requirements
- Navigation
- Acceptance criteria

## Repository layout

```
├── package.json       # Specs server app (deployed on Railway)
├── tsconfig.json
├── src/
│   ├── index.ts       # Specs MCP server + REST publish endpoint
│   └── store.ts       # Postgres / in-memory storage
├── github-mcp/        # GitHub Components MCP server + web UI
│   ├── src/
│   │   ├── index.ts   # MCP endpoint + REST + static web UI
│   │   ├── github.ts  # GitHub API client
│   │   └── tools.ts   # MCP tool implementations
│   ├── public/        # Web UI (landing/setup/playground/brainstorm)
│   └── Dockerfile
├── railway.json       # Railway deploy config (specs server)
└── widget/            # Figma widget source (spec form)
```

## Specs MCP — widget & server

### 1. Widget

```sh
cd widget
npm install
npm run build   # outputs dist/code.js
```

In Figma: **Menu → Widgets → Development → Import widget from manifest** and pick `widget/manifest.json`.

In the widget, set the **MCP Server URL** field to your Railway app URL (e.g. `https://your-app.up.railway.app`).

### 2. Server (Railway)

1. Create a Railway project and deploy this repo. The repo root is a plain Node app, so Railway auto-detects it with Nixpacks (`npm ci` → `npm run build` → `npm start`).
2. The server exposes:
   - `POST /api/specs` — where the widget publishes specs
   - `GET /health` — health check
   - `POST /mcp` — the MCP (Streamable HTTP) endpoint

The port comes from Railway's `PORT` env var (defaults to 8080).

### 3. Connect an agent

Point the agent's MCP client at `https://your-app.up.railway.app/mcp` (Streamable HTTP).

Available tools:

| Tool | Description |
| ---- | ----------- |
| `list_specs` | List published specs (id, nodeId, updatedAt) |
| `get_spec`   | Full spec for a given id, ready to build against |

## Notes

- The server uses Postgres for persistence. On Railway, create a **Postgres** plugin (or set a `DATABASE_URL` env var) and the server will automatically create and use the `specs` table. If your Postgres requires SSL, set the `PGSSL=true` env var. Without `DATABASE_URL`, it falls back to an in-memory store that resets on redeploy.
- The server listens before the database is ready and retries the DB connection in the background, so the healthcheck (`/health`) passes even while Postgres is still warming up.
- The widget's spec contents are stored as widget synced state in the Figma document.