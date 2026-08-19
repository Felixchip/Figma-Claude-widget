# Figma Product Spec Widget + MCP Server

A Figma/FigJam widget that captures a **product spec** for a design (frame/section) and publishes it to an MCP server. Coding agents (Claude, DeepSeek, ChatGPT) connected to that MCP server can then read the spec — including the Figma **Node ID** — and build the interface against your existing components repo.

## How it works

1. Attach the widget to a frame/section in Figma and fill in the spec fields.
2. Press **Publish** — the spec is POSTed to the MCP server (hosted on Railway).
3. Connect your agent (Claude, DeepSeek, ChatGPT, etc.) to the MCP server.
4. The agent calls `list_specs` / `get_spec` to read the spec and build the UI with the components from your GitHub repo.

## Spec fields

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
├── code.tsx          # Figma widget source (spec form)
├── manifest.json     # Widget manifest
├── railway.json      # Railway deploy config (points at server/)
└── server/
    ├── src/index.ts  # MCP server + REST publish endpoint
    └── package.json
```

## 1. Widget

```sh
npm install
npm run build   # outputs dist/code.js
```

In Figma: **Menu → Widgets → Development → Import widget from manifest** and pick `manifest.json`.

In the widget, set the **MCP Server URL** field to your Railway app URL (e.g. `https://your-app.up.railway.app`).

## 2. Server (Railway)

1. Create a Railway project and deploy this repo (`railway.json` targets the `server/` directory).
2. The server exposes:
   - `POST /api/specs` — where the widget publishes specs
   - `GET /health` — health check
   - `POST /mcp` — the MCP (Streamable HTTP) endpoint

The port comes from Railway's `PORT` env var (defaults to 8080).

## 3. Connect an agent

Point the agent's MCP client at `https://your-app.up.railway.app/mcp` (Streamable HTTP).

Available tools:

| Tool | Description |
| ---- | ----------- |
| `list_specs` | List published specs (id, nodeId, updatedAt) |
| `get_spec`   | Full spec for a given id, ready to build against |

## Notes

- Specs are stored in-memory on the server, so they reset on redeploy. Add a database (e.g. Railway Postgres) if you need persistence.
- The widget's API key and spec contents are stored as widget synced state in the Figma document.