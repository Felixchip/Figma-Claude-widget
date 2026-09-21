# GSA Build Kit — project status

A complete picture of what this is, what's built, what's outstanding, and what
needs another pass. Last updated with `v0.3.0`.

---

## 1. What it is

An MCP server plus a small web app that gives AI agents the real CMC Markets GSA
design system: the Figma component library, the design tokens, the SwiftUI
components in the code repo, published specs, the rules, and rendered images of
every component and variant. Agents stop inventing components.

Three routes, chosen by what the user asks for:

| Route | Trigger | How it works |
| --- | --- | --- |
| **Design in Figma** | "design this in my Figma file" | The agent authors nodes via **Figma's official MCP** (separate connection, the user's own Figma account). It needs a file link. |
| **Build** | "build this screen" | The agent writes SwiftUI reusing the real components from `Felixchip/design-system`. |
| **Render** | "generate an image of this screen" | The agent composes a mockup from real component renders. No Figma connection needed. |

Everything the Build Kit does is **read-only**. It never writes to Figma or the
repo.

---

## 2. Architecture

```
  ChatGPT plugin ─┐
  Codex ──────────┤
  Claude Code ────┼──►  gsa-build-kit MCP (stateless, HTTP)  ──►  Figma REST API
  Cursor ─────────┤            dsgn.up.railway.app/mcp            GitHub API
  Claude (app) ───┘                     │                         Postgres
                                        │                            │
  Web app  ◄────────────────────────────┘                    component_images
  /  /library  /settings  /brainstorm                         usage_events
                                                              settings

  Figma export plugin ──► POST /api/figma/upload  (themed renders)
  Figma widget ─────────► POST /api/specs         (product specs)
```

Stack: Node 20+, TypeScript, Express, `@modelcontextprotocol/sdk`, Postgres
(in-memory fallback without `DATABASE_URL`). Deployed on Railway from `main`.

---

## 3. Done

### 3.1 MCP server

- **14 tools**, all read-only, annotated `readOnlyHint`:

  | Group | Tools |
  | --- | --- |
  | Rules | `list_rules` |
  | Figma library | `get_figma_library`, `list_figma_components`, `get_figma_component`, `get_figma_tokens` |
  | Code repo | `get_repo_overview`, `list_components`, `get_component`, `get_repo_structure`, `search_components` |
  | Specs | `list_specs`, `get_spec` |
  | Renders | `render_figma_node`, `get_component_render` |

- **Stateless transport.** A fresh server + transport per request, no session id.
  Redeploys and extra replicas are invisible to connected agents (this fixed
  clients hanging on stale sessions).
- **Server instructions** carry the guardrails, the three routes, the palette and
  the workflow, so behaviour is consistent even before a tool is called.
- **Skills over MCP.** Advertises OpenAI's `io.modelcontextprotocol/skills`
  extension and implements `skills/list`, `skills/get` and `resources/read`, with
  SHA-256 digests. The skill travels with the server and is imported at plugin
  submission.
- **Fast reads.** `depth=1` version checks (60s cache) plus a persisted name →
  node map, so a cached render never fetches the whole Figma file.

### 3.2 Figma integration

- OAuth connect **and** PAT fallback; the library file is configurable in the UI.
- Library overview, component listing, per-component detail, and tokens
  (variables) with modes.
- **Noise filtering** (deprecated, hidden `_`, annotation arrows, `Frame N`,
  `Component N`, placeholder, page/line/dot, iOS chrome) and **name dedupe**
  preferring component sets.

### 3.3 Component library (renders)

- **1,632 images**: 544 components/variants × {default, Light, Dark}.
- Rendered server-side via the Figma Images API, batched, throttled and
  retried with backoff (this fixed 429 rate-limit failures).
- **Background warm-up job** with live progress (`/api/figma/render`,
  `/api/figma/render/status`). Skips anything already current, prunes stale
  entries, and never re-requests cached nodes.
- **Theme support** in the cache (composite key `node_id + theme`), served at
  `/api/figma/image/:nodeId?theme=Light`.
- **Preferred theme** so agents get Light automatically without passing a theme.

### 3.4 Themed exports (Figma plugin)

- `plugin/` — a Figma plugin that sets a variable mode, exports every variant per
  theme, and uploads to `POST /api/figma/upload`.
- This exists because the Figma REST image API **cannot select a variable mode**;
  only the Plugin API can. Confirmed against the OpenAPI spec.
- Mirrors the server's target selection exactly, so both produce the same 544.

### 3.5 Content and rules

- `RULES_PREAMBLE` (guardrails, platform, design sense, the three routes) plus
  runtime-editable **Component rules**, **Foundation**, and **Render guide**.
- Per-component usage rules with a Figma ↔ GitHub name matcher and manual alias
  overrides.
- Everything is served through `list_rules` / `design://rules`.

### 3.6 Web app

- `/` Overview: server status (repo, Figma, library counts), per-agent connection
  guide with the ChatGPT install link, and a **How to use** modal.
- `/library`: 1,632 renders grouped per component, collapsible, searchable, theme
  filter, admin section (token, preferred theme, render status).
- `/settings`: Sources, Component rules, Foundation, Render guide.
- `/brainstorm`: prompt generator.
- Admin writes gated by `ADMIN_TOKEN`.

### 3.7 ChatGPT / Codex plugin

- `chatgpt-plugin/` with **both manifest layouts**: `.codex-plugin/plugin.json`
  + `.mcp.json` (what local hosts load) and portable `plugin.json` + `mcp.json`
  (for public submission).
- Bundled skill at `skills/gsa-build-kit/SKILL.md` — also served by the MCP.
- Repo marketplace at `.agents/plugins/marketplace.json` for local testing.
- Install link wired into the web app's ChatGPT instructions.
- Packaged as `artifacts/gsa-build-kit.zip` via `npm run pack:plugin`.

### 3.8 Ops

- **Version**: `package.json` is the source of truth; `sync:versions` writes it
  into the plugin manifests; the server reports it in `/api/status` and the UI
  footer.
- **Smoke test**: `npm run smoke [baseUrl]` — 9 checks, exits non-zero on failure.
- **Usage stats**: anonymous tool-call counts (MCP + REST) in `usage_events`,
  exposed at `GET /api/usage` and summarised in Settings.
- **Changelog**, **onboarding doc**, and a README covering every surface.

---

## 4. Pending (before a wider rollout)

| # | Item | Why it matters | Effort |
| --- | --- | --- | --- |
| 1 | **Decide exposure** | The MCP and web app are public and unauthenticated. The Figma library, tokens, images and the **SwiftUI source from a private repo** are world-readable. Needs a yes/no from the design-system owner + security. | decision |
| 2 | **Publish the plugin to the CMC workspace** | The install link currently resolves for the author's account only. Personal → ⋯ → Publish → roles (workspace admin). | 10 min |
| 3 | **Web app auth** | Basic auth via `WEB_AUTH_USER` / `WEB_AUTH_PASS`, exempting `/mcp` and `/health`. ~15 lines, off by default. | small |
| 4 | **Rate limiting** | Nothing protects `/mcp` or `/api/figma/image/:nodeId` today. | small |
| 5 | **Staging environment** | A second Railway service + DB so a bad push doesn't take the tool down for everyone, plus a documented rollback. | small |
| 6 | **Error monitoring** | Failures are only visible in Railway logs. Sentry (or similar). | small |
| 7 | **Editor identity + audit** | Rules/Foundation/Render-guide edits share one `ADMIN_TOKEN` with no history; a bad edit can't be attributed or reverted. Per-person tokens + revisions. | medium |
| 8 | **Token cost** | `get_component_render` returns base64 images, which is expensive in tokens. Consider returning the URL plus a small preview by default. | medium |

---

## 5. Needs revisiting / improvement

**Correctness and coverage**

- **Theme coverage is uneven.** Only components whose appearance differs by mode
  actually need dual renders; today we export all 544 per theme. Fine, but the
  Figma file's default mode still drives the `default` set, which is why the
  inputs rendered dark before the Light export existed.
- **Noise heuristics are hardcoded.** `isNoiseComponent` is a denylist tuned to
  the current file. A new naming convention could silently leak junk or drop a
  real component. Consider making it admin-editable.
- **Registry matching is name-based.** `GSA` prefix stripping plus aliases is
  pragmatic but brittle; a renamed component on either side silently loses its
  pairing.

**Themed renders**

- **The Figma plugin is manual.** It can't run headless, so someone must open
  Figma and click Export whenever the library changes. There is no CI hook and no
  freshness indicator in the UI (beyond the file version).
- **The skills extension is a draft spec** (SEP-2640 subset). OpenAI may change
  it; `src/skills.ts` will need revisiting.

**Operational**

- **No automated tests.** The smoke test covers the happy path; nothing covers
  the render job, the resolver, or the store migrations.
- **`preferred_theme` is global.** One setting for everyone. Per-user or
  per-agent would be better once there are real users.
- **Usage `detail` stores the query string.** Useful, but it's user-entered text
  in the database — worth confirming that's acceptable, or hashing/truncating it.
- **In-memory fallback hides Postgres problems.** Without `DATABASE_URL` the
  server silently uses memory; a misconfigured deploy looks fine until restart.
  Consider failing loudly in production.

**Web app**

- **Not responsive.** The UI is built for desktop widths.
- **No mobile/touch pass** on the Library grid.
- **Library performance** at 1,632 images relies on lazy loading and collapsing;
  worth re-checking on a low-end laptop.

**Product gaps**

- **The Figma widget (specs) may be stale.** It's the only writer of specs and
  isn't covered by the smoke test.
- **DeepSeek is documented but untested** — there's no first-party MCP client, so
  the Cline/Continue path is unverified.
- **No feedback loop in the UI.** The onboarding doc points at GitHub issues; a
  one-click "something's wrong" would get more signal.

---

## 6. Reference

### Endpoints

| Read | Write (admin) |
| --- | --- |
| `GET /health`, `GET /api/status`, `GET /api/usage` | `POST /api/figma/render`, `POST /api/figma/upload` |
| `GET /api/rules`, `/api/foundation`, `/api/render-guide` | `PUT /api/rules`, `/api/foundation`, `/api/render-guide` |
| `GET /api/components`, `/api/aliases`, `/api/specs` | `POST /api/components/sync`, `PUT /api/aliases` |
| `GET /api/figma/images`, `/api/figma/image/:nodeId` | `PUT /api/preferred-theme`, `DELETE /api/figma/images` |
| `POST /api/tools/:name` (playground), `POST /mcp` | `POST /api/figma/pat`, `/api/figma/library`, `/api/figma/disconnect` |

### Scripts

| Command | Does |
| --- | --- |
| `npm run build` | Compile TypeScript |
| `npm start` | Run the server |
| `npm run smoke [baseUrl]` | Post-deploy smoke test |
| `npm run sync:versions` | Push `package.json` version into the plugin manifests |
| `npm run pack:plugin` | Sync versions, then build `artifacts/gsa-build-kit.zip` |

### Environment

`FIGMA_PAT`, `FIGMA_FILE_KEY`, `FIGMA_CLIENT_ID`/`FIGMA_CLIENT_SECRET` (OAuth),
`GITHUB_REPO`, `GITHUB_TOKEN`, `ADMIN_TOKEN`, `PUBLIC_BASE_URL`, `DATABASE_URL`,
`PGSSL`. Railway also supplies `RAILWAY_GIT_COMMIT_SHA`.

### Folders

`src/` server · `public/` web app · `plugin/` Figma themed-export plugin ·
`widget/` Figma spec widget · `chatgpt-plugin/` ChatGPT/Codex plugin ·
`scripts/` tooling · `docs/` documentation · `artifacts/` build output.

---

## 7. Suggested sequencing

1. **Decide exposure** (#1) — it gates everything else. If the answer is "not
   public", options 3–4 change shape and ChatGPT may need OAuth.
2. **Ship the reversible safety net** — web auth (#3) and rate limiting (#4),
   both off by default.
3. **Publish the plugin to the workspace** (#2) and share the onboarding doc.
4. **Add staging + monitoring** (#5, #6) before the user count grows.
5. Then the quality items: editor identity (#7), token cost (#8), and the
   improvement list in section 5.
