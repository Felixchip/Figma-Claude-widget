# CMC Build Kit

One MCP server + web UI that gives your agents (Claude, DeepSeek, ChatGPT) everything they need to design and build **on-brand** interfaces:

- **Figma design library** connected by an admin (`get_figma_library`, `list_figma_components`, `get_figma_component`, `get_figma_tokens`)
- **Product specs** published from the Figma widget (`list_specs`, `get_spec`)
- **Code components repo** on GitHub (`list_components`, `get_component`, `search_components`, `get_repo_structure`, `get_repo_overview`)
- **Web UI** at the root: overview, settings (Figma + GitHub), brainstorm prompt generator

## How it works

1. An admin connects a Figma account (read-only OAuth) in the web UI and picks the design library file.
2. Agents connect to this MCP server — they see the Figma library, specs, and GitHub components tools in one interface.
3. Agents follow the mandatory design rules and build interfaces reusing the real Figma components, tokens, and repo components.

## One MCP endpoint, all tools

| Tool | Source | Purpose |
| ---- | ------ | ------- |
| `list_rules` | rules | **Mandatory** design-system component usage & rules doc |
| `get_figma_library` | Figma | Connected design library overview (file, pages) |
| `list_figma_components` | Figma | List components in the Figma library |
| `get_figma_component` | Figma | Details of one Figma component by name |
| `get_figma_tokens` | Figma | Design tokens/variables from the Figma library |
| `list_specs` | specs | List published product specs |
| `get_spec` | specs | Full spec for an id |
| `get_repo_overview` | GitHub | Repo name, description, default branch |
| `list_components` | GitHub | List component files |
| `get_component` | GitHub | Full source of a component file |
| `get_repo_structure` | GitHub | Directory structure |
| `search_components` | GitHub | Search component names/paths |

## Figma OAuth setup

To let admins connect a Figma library:

1. Go to **Figma → Settings → Security → OAuth apps** and create a new app.
2. Set the **Redirect URI** to `https://<your-app>.up.railway.app/api/figma/oauth/callback`.
3. Set the **scopes** to `file_read` (read-only).
4. Add env vars on Railway:

| Var | Purpose |
| --- | ------- |
| `FIGMA_CLIENT_ID` | Figma OAuth app client id |
| `FIGMA_CLIENT_SECRET` | Figma OAuth app secret |
| `PUBLIC_BASE_URL` | Your app URL, e.g. `https://your-app.up.railway.app` |

5. In the web UI → Settings → **Connect Figma**, then paste a design library file URL and **Pick library**.

The connected token + library are stored server-side (Postgres) and exposed to agents via the Figma MCP tools.

## Mandatory rules

The design-system component rules (`docs/ComponentUsage.md`) are binding for any agent connected to the MCP. They are delivered through the protocol itself:

- **Server `instructions`** — every client receives a directive in the `initialize` response telling the agent it MUST read and abide by the rules before building.
- **Resource `design://rules`** — the full rules doc, readable via MCP `resources/read`.
- **`list_rules` tool** — agents can pull the full doc on demand.
- **Rules reminder** — `list_components` and `get_component` prepend a reminder that the rules apply.

## Repository layout

```
├── package.json       # Unified server (deployed on Railway)
├── src/
│   ├── index.ts       # MCP endpoint + REST + static web UI
│   ├── store.ts       # Postgres / in-memory spec + settings storage
│   ├── github.ts      # GitHub API client
│   ├── tools.ts       # GitHub component tool implementations
│   ├── figma.ts       # Figma OAuth + API client
│   └── figmaTools.ts  # Figma library MCP tools
├── public/            # Web UI (overview/settings/brainstorm)
├── railway.json       # Railway deploy config
└── widget/            # Figma widget source (spec form)
```

## Deploy on Railway (one service)

1. Create a Railway project and deploy this repo. The repo root is a plain Node app, so Railway auto-detects it with Nixpacks (`npm ci` → `npm run build` → `npm start`).
2. Add a **Postgres** plugin (sets `DATABASE_URL`) — the server auto-creates the `specs` table. Set `PGSSL=true` if connection errors appear.
3. Set env vars for the components repo:

| Var | Purpose |
| --- | ------- |
| `GITHUB_REPO` | Components repo, e.g. `acme/web` |
| `GITHUB_OWNER` + `GITHUB_REPO_NAME` | Alternative to `GITHUB_REPO` |
| `GITHUB_TOKEN` | Token (required for private repos) |
| `GITHUB_BRANCH` | Branch to read (default `main`) |
| `FIGMA_CLIENT_ID` / `FIGMA_CLIENT_SECRET` | Figma OAuth app credentials (see Figma OAuth setup) |
| `PUBLIC_BASE_URL` | Your app URL, e.g. `https://your-app.up.railway.app` |

Result: `https://<your-app>.up.railway.app` — web UI at `/`, MCP at `/mcp`, healthcheck at `/health`.

## Connect your agent

Add **two** MCP servers so the agent sees design + code context:

```json
{
  "mcpServers": {
    "figma":          { "url": "https://mcp.figma.com/mcp" },
    "design-system":  { "url": "https://<your-app>.up.railway.app/mcp" }
  }
}
```

Claude Code:

```sh
claude mcp add --transport http figma https://mcp.figma.com/mcp
claude mcp add --transport http design-system https://<your-app>.up.railway.app/mcp
```

Suggested prompt:

```
Use the Figma MCP (get_design_context + get_variable_defs) to read the design,
and the design-system MCP (list_components, get_component, list_specs, get_spec)
to pick components and read product specs from our repo.
Build the UI reusing our components and design tokens. Stay on-brand.
```

## Figma widget

```sh
cd widget
npm install
npm run build   # outputs dist/code.js
```

In Figma: **Menu → Widgets → Development → Import widget from manifest** and pick `widget/manifest.json`. Set the **MCP Server URL** field to `https://<your-app>.up.railway.app`.

## REST API (for the widget and playground)

| Endpoint | Purpose |
| -------- | ------- |
| `POST /api/specs` | Publish a spec (used by the widget) |
| `GET /api/specs` | List specs |
| `GET /api/specs/:id` | Get one spec |
| `POST /api/tools/:name` | Call any MCP tool (used by the web playground) |
| `GET /api/status` | Server + repo status |
| `GET /health` | Health check |

## Notes

- Specs are stored in Postgres (in-memory fallback without `DATABASE_URL`). The server listens before the DB is ready and retries in the background.
- Each MCP client gets its own server instance, so multiple agents can connect concurrently.
- Without a `GITHUB_TOKEN`, GitHub API calls are rate-limited (60/hour/IP for public repos).
