# GSA Build Kit

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
| `ADMIN_TOKEN` | Optional bearer token to sync/edit component usage rules |
| `GITHUB_TOKEN` | Required for discovering components from a private repo |

Result: `https://<your-app>.up.railway.app` — web UI at `/`, MCP at `/mcp`, healthcheck at `/health`.

### Component usage rules

Component usage rules are **generated per component**, not one big document:

- Components are discovered automatically from the **Figma library** and the **GitHub repo** and merged by name (a `GSA` prefix is stripped for matching, so `GSAButton` and Figma `Button` become one entry).
- Every discovered component starts with an **empty rule**. An admin defines each rule in the web UI (Settings → Component usage rules) or via `PUT /api/components/:key/rule`.
- `POST /api/components/sync` re-discovers components from the live sources; previously saved rules are preserved by key.
- When an agent reads `list_rules` / `design://rules`, they get the static guardrails/platform preamble plus one section per component that has a rule, and a list of components that still have no rule defined.

No code change or redeploy is needed to update component guidance. Set `ADMIN_TOKEN` to protect sync/edits.

## Connect your agent

The MCP is named `gsa-build-kit`. Add it (plus Figma's official MCP) so the agent sees design + code context:

```json
{
  "mcpServers": {
    "figma":          { "url": "https://mcp.figma.com/mcp" },
    "gsa-build-kit":  { "url": "https://<your-app>.up.railway.app/mcp" }
  }
}
```

Claude Code:

```sh
claude mcp add --transport http gsa-build-kit https://<your-app>.up.railway.app/mcp
claude mcp add --transport http figma https://mcp.figma.com/mcp
```

Add `--scope user` to make a server available in every project (the default is
current-project only). Check the result with `/mcp` or `claude mcp list`. In a
`.mcp.json` entry, remote servers need an explicit `"type": "http"` — an entry
with a `url` but no `type` is read as a stdio server and skipped.

### ChatGPT / Codex connector

The `gsa-build-kit` MCP is a **stateless** Streamable HTTP server at
`https://<your-app>.up.railway.app/mcp` and works as an open connector (no per-user
login). All tools are read-only.

1. **ChatGPT app**: Settings → **Plugins** → **MCP Servers** → **Add server** →
   **Streamable HTTP**, paste the URL. If the option isn't visible, turn on
   **Developer mode** under Settings → **Security and login**. On the web, add it
   at [chatgpt.com/plugins](https://chatgpt.com/plugins) (plus button → MCP server URL).
2. **Codex CLI**: `codex mcp add gsa-build-kit --url https://<your-app>.up.railway.app/mcp`
3. **Codex config file** (`~/.codex/config.toml`, shared by the desktop app, CLI and
   IDE extension):

```toml
[mcp_servers.gsa-build-kit]
url = "https://<your-app>.up.railway.app/mcp"
```

ChatGPT **web** doesn't read local Codex config — it uses plugins/connectors
installed in the workspace.

Design/write flow for ChatGPT users:
- The Build Kit connector supplies the components/tokens/rules (read-only, shared).
- Writing into a user's own Figma file is done through Figma's official MCP (https://mcp.figma.com/mcp), which ChatGPT connects separately with the user's own Figma account.

### Claude app (claude.ai / Claude Desktop)

Settings → **Connectors** → **Add custom connector**, then paste the server URL.
Custom connectors require a paid plan. For the terminal, use Claude Code instead.

### Cursor

`Customize → MCP`, or add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json`
(project). Remote servers are configured with a `url`:

```json
{
  "mcpServers": {
    "gsa-build-kit": { "url": "https://<your-app>.up.railway.app/mcp" }
  }
}
```

### DeepSeek

DeepSeek has no first-party MCP client. Use an MCP-capable client with DeepSeek as
the model — Cline, Roo Code, Continue, or Cherry Studio — and add this server there.

Suggested prompt:

```
Use the Figma MCP (get_design_context + get_variable_defs) to read the design,
and the gsa-build-kit MCP (list_rules, get_figma_library, list_figma_components,
get_figma_component, get_figma_tokens, list_components, get_component, list_specs,
get_spec) to follow the mandatory rules, read the design library and tokens,
pick components, and read product specs.
Build the UI using ONLY the components in our design system. Stay on the CMC brand.
```

## ChatGPT / Codex plugin

`chatgpt-plugin/` packages the MCP server and a skill into an installable plugin,
so ChatGPT and Codex know to start with the rules and library before designing,
building or rendering.

```
chatgpt-plugin/
├── plugin.json                     portable manifest (Agent Plugins schema)
├── mcp.json                        bundled MCP server (streamable HTTP)
├── skills/gsa-build-kit/SKILL.md   the workflow instructions
└── assets/icon.png
```

Test it locally with the repo marketplace at `.agents/plugins/marketplace.json`:
restart the ChatGPT desktop app, open the **Plugins** directory, choose the
**GSA Build Kit (local)** source, and install it. See `chatgpt-plugin/README.md`
for the personal-marketplace alternative and the publishing steps.

The skill is also **served by the MCP server**: it advertises OpenAI's
`io.modelcontextprotocol/skills` extension and implements `skills/list`,
`skills/get` and `resources/read`, reading the files from
`chatgpt-plugin/skills/`. So the skill always travels with the server, and
**Scan Tools** imports it into the plugin draft at submission. That folder is
the single source of truth for the skill.

## Figma widget

```sh
cd widget
npm install
npm run build   # outputs dist/code.js
```

In Figma: **Menu → Widgets → Development → Import widget from manifest** and pick `widget/manifest.json`. Set the **MCP Server URL** field to `https://<your-app>.up.railway.app`.

## Figma export plugin (themed renders)

Figma's REST image API can only render one variable mode, so the server-side render
produced whatever mode the file defaults to. The plugin runs inside Figma, where the
mode **can** be set, so it exports every component variant once per theme.

```sh
cd plugin
npm install
npm run build   # outputs dist/code.js
```

`dist/code.js` is committed, so you only need the build step if you change `code.ts`.

In Figma: **Menu → Plugins → Development → Import plugin from manifest** and pick
`plugin/manifest.json`. Then run **Plugins → Development → GSA Build Kit Export**:

1. Enter the server URL and your `ADMIN_TOKEN`.
2. Pick the theme collection (auto-selected if a collection has Light + Dark modes).
3. Tick the themes to export and click **Export & upload**.

It walks the file, sets each theme's mode, exports every variant to PNG at 2×, and
POSTs batches to `POST /api/figma/upload`. The Library page then shows both themes
(with a theme filter), and agents can request a theme:

```
get_component_render("Text fields", theme: "Light")
```

Notes:

- A plugin cannot run headless, so re-run it whenever the library changes.
- Uploaded themes are stored alongside the default render (keyed by node id + theme)
  and are never pruned by the server-side warm-up.
- Server-rendered images use theme `""` (shown as **Default** in the Library).

## REST API (for the widget and playground)

| Endpoint | Purpose |
| -------- | ------- |
| `POST /api/specs` | Publish a spec (used by the widget) |
| `GET /api/specs` | List specs |
| `GET /api/specs/:id` | Get one spec |
| `POST /api/tools/:name` | Call any MCP tool (used by the web playground) |
| `POST /api/figma/render` | Start the background render warm-up (admin) |
| `GET /api/figma/render/status` | Warm-up progress |
| `GET /api/figma/images` | List cached component renders |
| `GET /api/figma/image/:nodeId` | Serve a render (`?theme=Light` optional) |
| `POST /api/figma/upload` | Plugin uploads themed renders (admin) |
| `DELETE /api/figma/images` | Clear the render cache (admin) |
| `GET /api/status` | Server + repo status |
| `GET /health` | Health check |

## Notes

- Specs are stored in Postgres (in-memory fallback without `DATABASE_URL`). The server listens before the DB is ready and retries in the background.
- Each MCP request gets its own server instance, so multiple agents can connect concurrently.
- The MCP endpoint is **stateless** (no session id): a redeploy restarts the container, and stateful sessions would be lost — clients would then hang on a stale session id. Stateless means deploys (and extra replicas) are invisible to connected agents. All tools are read-only request/response, so nothing is lost by not keeping sessions.
- Without a `GITHUB_TOKEN`, GitHub API calls are rate-limited (60/hour/IP for public repos).
