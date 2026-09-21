# GSA Build Kit — getting started

One page for internal users. Share this instead of explaining it each time.

**What it is.** A connection that gives your AI agent the real CMC Markets GSA
design system: the Figma component library, the design tokens, the SwiftUI
components in the code repo, the published specs, the rules, and rendered
images of every component. Your agent stops inventing components.

**Who it's for.** Designers, engineers and PMs working on CMC interfaces with
ChatGPT, Codex, Claude, Claude Code, Cursor or any MCP-capable agent.

**Web app:** https://dsgn.up.railway.app — browse the component library, read
the rules, and see the per-agent setup.

---

## Connect (pick one)

### ChatGPT
Install the plugin: **https://chatgpt.com/plugins/Plugin_e479615d1dc881919dcff3352174c5a7?open_in_app**

Then start a chat, type `@`, and pick **GSA Build Kit**.

### Codex
```sh
codex mcp add gsa-build-kit --url https://dsgn.up.railway.app/mcp
```
Or add to `~/.codex/config.toml`:
```toml
[mcp_servers.gsa-build-kit]
url = "https://dsgn.up.railway.app/mcp"
```

### Claude Code
```sh
claude mcp add --transport http gsa-build-kit https://dsgn.up.railway.app/mcp
```
Add `--scope user` to enable it in every project.

### Cursor
`Customize → MCP`, or add to `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "gsa-build-kit": { "url": "https://dsgn.up.railway.app/mcp" }
  }
}
```

### Claude (app)
Settings → **Connectors** → **Add custom connector** → paste
`https://dsgn.up.railway.app/mcp`. Needs a paid plan.

### DeepSeek / other
Use an MCP-capable client (Cline, Roo Code, Continue, Cherry Studio) and add the
same URL.

---

## Use it

**Always start the chat by loading the Build Kit**, for example:

> Start with the GSA Build Kit, then design a stock order ticket.

That makes the agent read the rules, components and tokens before it does
anything. Then it routes your request:

| You ask for | What happens |
| --- | --- |
| "design this in my Figma file" | The agent creates it in Figma, using Figma's own MCP and your Figma account. It will ask for a file link. |
| "build this screen" | The agent writes SwiftUI reusing the real components from the code repo. |
| "generate an image of this screen" | The agent composes a mockup from the real component images. No Figma connection needed. |

Useful things to try:
- "What components exist for showing price changes?"
- "Design a watchlist row using the GSA components."
- "Show me the Chip component in the Light theme."

---

## Good to know

- **Read-only.** The Build Kit never changes your Figma file or the repo. It
  only reads. (Creating designs in Figma happens through Figma's own MCP, under
  your account.)
- **No invented components.** If a piece of UI has no component, the agent
  should stop and ask you, not improvise one.
- **Library freshness.** Rendered images refresh when an admin clicks
  *Render / refresh* on the [Library](https://dsgn.up.railway.app/library) page.
  If something looks out of date, say so in the channel below.
- **Themes.** Renders exist per theme (Default, Light, Dark). Admins set the
  preferred theme agents get by default.

---

## Data handling

Prompts and tool results are sent to your chosen AI provider (OpenAI, Anthropic,
etc.) as part of using their agent. The Build Kit returns component names,
descriptions, tokens, SwiftUI source and rendered images from the CMC design
system and the `design-system` repo. Nothing else is read, and no user data is
stored by the Build Kit beyond anonymous tool-call counts.

---

## Ownership and feedback

- **Owner:** GSA / design system team.
- **Issues, requests, missing components:** open an issue at
  https://github.com/Felixchip/Figma-Claude-widget/issues
  (swap this for your team channel if you prefer — Slack `#gsa-build-kit`).
- **Server status:** https://dsgn.up.railway.app/api/status
