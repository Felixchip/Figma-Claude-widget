# Changelog

`package.json` is the single source of truth for the version. The server and the
ChatGPT plugin manifests read from it (`npm run sync:versions`).

## 0.3.0

- **Stateless MCP** — each request gets a fresh server, so redeploys no longer
  drop connected agents.
- **Component library** — rendered images of every component and variant, grouped
  per component, with theme filter and a preferred theme for agents.
- **Themed renders** — a Figma plugin exports every variant per theme (Light,
  Dark) and uploads them; the REST API cannot pick a variable mode.
- **Fast lookups** — depth=1 version checks plus a persisted name → node map, so
  cached reads don't fetch the whole Figma file.
- **Skills served by the MCP** — the `gsa-build-kit` skill is exposed over the
  `io.modelcontextprotocol/skills` extension for import at plugin submission.
- **ChatGPT / Codex plugin** — packaged plugin with manifest, bundled MCP server,
  skill and install link.
- **Usage stats** — anonymous tool-call counts at `GET /api/usage`.
- **Smoke test** — `npm run smoke [baseUrl]` exercises the paths users hit.

## 0.2.0

- Unified MCP server: Figma library, GitHub components, specs and rules.
- Web UI: Overview, Settings (Sources, Component rules, Foundation, Render guide),
  Brainstorm, Library.
- Product spec widget for Figma.

## 0.1.0

- Initial MCP server with Figma library and repo component tools.
