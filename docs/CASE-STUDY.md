# Case study — GSA Build Kit

> Giving AI agents a real design system.
>
> **Role:** design engineer (end to end — product, server, web UI, Figma plugins)
> **Status:** v0.3.0, deployed, in internal rollout
> **Stack:** TypeScript, Node, Express, MCP SDK, Postgres, Figma Plugin API, Railway

---

## The problem

Our designers and engineers had started using AI agents to build UI. The agents
were good at layout and bad at *us*. Ask for a watchlist row and you'd get an
invented button, an off-brand blue, spacing that didn't match anything, and a
component that didn't exist in the codebase. The design system existed — but it
lived in Figma and a private Swift package, and the agent could see neither.

The real problem wasn't generation quality. It was **context**. The agent was
guessing because it had nothing to guess *from*.

So the brief I set: give the agent the actual design system — components,
tokens, rules and real component images — and make it impossible for it to
invent anything.

---

## Approach

Four principles shaped every decision:

1. **Read-only.** The Build Kit never writes to Figma or the repo. Agents that
   can write to a shared design file are a liability; agents that read it are a
   force multiplier. Authoring stays with the human, or with Figma's own MCP
   under the user's account.
2. **Don't invent, verify.** Every component, prop and token an agent uses has
   to come from a tool call. The rules say so explicitly, and the tools make it
   cheap.
3. **One surface, three routes.** Users don't want to learn a tool; they want
   the outcome. "Design this in Figma", "build this" and "make an image of this"
   are three different jobs, and the system routes them.
4. **Meet agents where they are.** ChatGPT, Codex, Claude Code, Cursor — one
   MCP endpoint, plus a packaged plugin for the ones that need it.

---

## What I built

A single MCP server that exposes the design system to any capable agent:

| Surface | What it gives the agent |
| --- | --- |
| **Figma library** | Component sets, variants, descriptions, design tokens with modes |
| **Code repo** | SwiftUI components, repo structure, search |
| **Renders** | Real images of all 544 components/variants, per theme |
| **Rules** | Guardrails, platform, design sense, per-component usage rules |
| **Specs** | Product specs published from a Figma widget |

Plus a web app to browse the library and administer content, a Figma plugin that
exports themed renders, and a packaged ChatGPT/Codex plugin.

**By the numbers**

| | |
| --- | --- |
| MCP tools | 15, all read-only |
| Components / variants | 544 across 32 component groups |
| Rendered images | 1,632 (544 × default / Light / Dark), 2.4 MB |
| Figma file | 1,160 variants scanned, noise-filtered and deduped |
| Surfaces | ChatGPT, Codex, Claude Code, Cursor, Claude app |
| First full warm-up | 43 seconds for 146 images; now 1,632 |

---

## The hard problems

This is where the work actually was. Each one changed how the system works.

### 1. "How is it just 14 components?"

My first cut picked which components to render from a hardcoded **allowlist** of
names I'd typed out. It looked fine. Then the question came: *how is it just 14?*
— and the answer was that anything not on my list had been silently dropped.
Real components were missing, and nothing warned anyone.

**Decision:** invert it. A **denylist** (deprecated, hidden `_`, annotation
arrows, `Frame N`, `Component N`, placeholder, page/line/dot, iOS chrome) keeps
everything real and drops only known noise. Allowlists fail silently; denylists
fail visibly.

### 2. Rendering the wrong thing, three times

The agent needed visual references. First attempt: render each component *set*
as one image. The result was a 1302×1908 grid of every variant — technically
complete, useless as a reference. Second attempt: one representative variant per
set (preferring enabled/default/medium). Clean, but it hid the variations.
Third: **every variant, individually**.

**Decision:** one image per variant, grouped per component in the UI. The
interesting part wasn't the final answer — it was that "render the components"
turned out to be a product question, not an API question.

### 3. Figma rate-limited us into the ground

A warm-up run failed 504 of 544 images with `429 Rate limit exceeded`. Two bugs
behind one symptom: I was requesting images for nodes I'd **already cached** and
then discarding them, and I had no backoff.

**Decision:** compute what's missing *before* calling Figma (one DB query),
retry 429/5xx with exponential backoff honouring `Retry-After`, and throttle
batches. A re-warm with a warm cache now makes **zero** Figma calls.

### 4. The warm-up that returned 502

Rendering ~500 images synchronously meant the HTTP request outlived Railway's
proxy timeout, and the user saw "upstream error" with no explanation.

**Decision:** never do long work inside a request. The endpoint now starts a
**background job** and returns `202` immediately; progress is polled at
`/api/figma/render/status` and surfaced live in the UI.

### 5. The theme wall

Users reported the inputs were rendering dark while everything else was light.
The cause was subtle: the components' appearance is driven by Figma **variable
modes**, and the components' variant names contain no theme axis at all.

I read Figma's OpenAPI spec to confirm the hard limit: the images endpoint
accepts `ids`, `scale`, `format`, `svg_*`, `contents_only`, `use_absolute_bounds`
— and **no mode parameter**. Server-side rendering can only ever produce one
theme.

**Decision:** build a **Figma plugin**. The Plugin API *can* set a variable mode
before exporting, which the REST API cannot. The plugin walks the file, sets
each theme, exports every variant, and uploads them. The server can't render a
theme, and now it doesn't pretend to — asking for an uncached theme returns a
clear error pointing at the plugin.

This one mattered because the "obvious" fixes (flip the file's default mode,
call the API differently) were both dead ends, and I could only rule them out by
reading the spec.

### 6. The agent kept asking for a Figma link

Asked to "generate an image of a stock order ticket", the agent replied asking
for a Figma file link. Nothing in the instructions said the MCP was read-only, so
it reasonably assumed "create a design" meant "go edit Figma".

I over-corrected first — telling the agent to **never** ask for a Figma link —
which was wrong, because creating designs inside Figma is a legitimate route that
genuinely needs one.

**Decision:** name the three routes explicitly, in both the server instructions
and the rules doc. Design-in-Figma uses **Figma's own MCP** with the user's
account and *does* ask for a link. Render *never* does. Then encode it as a
**skill** so the routing survives outside the server instructions.

### 7. Deploys were killing connected agents

Sessions lived in an in-memory map. Every deploy emptied it, and a client holding
a stale session id got a `400` — which, unlike the spec's `404`, tells a client
"bad request" rather than "re-initialize". So it hung.

**Decision:** go **stateless**. A fresh server and transport per request, no
session id, unknown ids simply ignored. Every tool is read-only request/response,
so sessions were buying nothing. Deploys — and future replicas — are now
invisible to connected agents.

### 8. Shipping it was a different problem

Getting the server right was half the work. Distribution had its own traps:

- Local hosts load `.codex-plugin/plugin.json`, **not** the portable root
  `plugin.json` I'd built first — the giveaway was an error naming the *plugin*
  folder as a marketplace root.
- `codex plugin marketplace add` takes the marketplace **root**, not the plugin
  folder.
- OpenAI **cannot send static API keys or custom headers**, which rules out the
  simplest auth option for ChatGPT entirely.

**Decision:** ship **both** manifest layouts, document the exact commands, and
serve the skill **from the MCP** (via the `io.modelcontextprotocol/skills`
extension) so it always travels with the server instead of living in a folder
someone forgets to update.

---

## Decisions and tradeoffs

| Decision | Chose | Gave up |
| --- | --- | --- |
| Exposure | Read-only, anonymous | Per-user identity; needs a security sign-off |
| Rendering | Server-side REST for the default set, plugin for themes | The plugin can't run headless — a human must re-run it |
| Caching | Node id + theme, version-checked at `depth=1` | Staleness up to the warm-up cadence |
| Sessions | Stateless | Server→client push notifications (unused) |
| Skill delivery | Served by the MCP | Tied to a draft spec (SEP-2640) that may change |
| Auth for writes | Single shared `ADMIN_TOKEN` | Attribution and per-person audit |

---

## Working with feedback

Most of the sharpest improvements came from pushback, not from the plan:

- *"That design is horrible. It needs to be clean."* → rebuilt the Library twice,
  landing on quiet grouped sections with flat thumbnails.
- *"Why did you complicate the Codex config?"* → the config snippets went back to
  one server, one line; the Figma MCP moved into the hint text.
- *"Shouldn't they be one file?"* → two plugin zips collapsed into one, because
  the second was pure duplication.
- *"The skills should ALWAYS be part of the plugin/MCP."* → implemented the skills
  extension so the skill is served by the server, not bundled and forgotten.

The pattern: the first version was usually complete and slightly wrong. The fix
was almost always *less*.

---

## Where it is now

**Done:** MCP server (15 tools, stateless, skills over MCP) · Figma integration
with noise filtering and dedupe · 1,632 themed renders with a background warm-up ·
Figma export plugin · rules/foundation/render-guide content system · web app
(Overview, Library, Settings, Brainstorm) · ChatGPT/Codex plugin with both
manifest layouts and an install link · versioning, smoke test, usage stats,
changelog, onboarding and status docs.

**Pending:** the exposure decision (the MCP is public and unauthenticated; the
SwiftUI source comes from a private repo) · publishing the plugin to the
workspace · web app auth · rate limiting · staging and error monitoring · editor
identity with audit history · token cost of returning images.

**Open questions:** whether the Figma plugin's manual run is acceptable long-term,
whether `preferred_theme` should be per-user, and whether the repo's source code
belongs on a public endpoint at all.

See [STATUS.md](STATUS.md) for the full picture.

---

## What I'd do differently

- **Read the spec before designing the workaround.** The theme limitation was in
  Figma's OpenAPI document the whole time. Ten minutes there would have saved
  two wrong turns.
- **Treat "which components" as a product question.** I shipped an allowlist
  because it was easy, and it silently dropped real work.
- **Design for the second deploy.** Stateful sessions looked fine until the
  first redeploy broke every connected agent.
- **Assume the agent will misread the instructions.** If a route needs to be
  distinguished, say so explicitly and encode it in a skill — don't rely on
  inference.

---

## Keeping this current

This is a living document. When the app changes:

1. **Metrics** — refresh the "By the numbers" table from `GET /api/status`
   (library counts, version) and the tool count in the MCP `tools/list`.
2. **Hard problems** — add a new entry when a problem forces a design change, not
   for routine features. The value is in the *decision*, so keep the
   problem → discovery → decision → outcome shape.
3. **Decisions and tradeoffs** — add a row whenever something is consciously
   given up.
4. **Where it is now** — move items from *Pending* to *Done* as they ship; keep
   the honest gaps in [STATUS.md](STATUS.md) in step with it.
5. **Working with feedback** — worth updating while it's still true that the
   best changes came from disagreement.
