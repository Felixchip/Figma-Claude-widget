# GSA Build Kit — ChatGPT / Codex plugin

Packages the GSA Build Kit MCP server plus a skill, so ChatGPT and Codex know
how to use it: start with the rules and library, then design in Figma, build
SwiftUI, or render a mockup.

## Contents

```
chatgpt-plugin/
├── plugin.json                     portable manifest (Agent Plugins schema)
├── mcp.json                        bundled MCP server (streamable HTTP)
├── skills/gsa-build-kit/SKILL.md   the workflow instructions
└── assets/icon.png
```

`plugin.json` carries the OpenAI presentation under `extensions.com.openai`
(display name, category, brand colour, icon, starter prompts). The MCP server
is the deployed Build Kit at `https://dsgn.up.railway.app/mcp`; change the URL
in `mcp.json` if you deploy elsewhere.

## Test it locally

The repo ships a marketplace at `.agents/plugins/marketplace.json` that points
at `./chatgpt-plugin`.

1. Restart the ChatGPT desktop app.
2. Open the **Plugins** directory and pick the **GSA Build Kit (local)** source.
3. Install the plugin, then start a new chat and invoke it with `@`.

For a personal marketplace instead of the repo one, copy the plugin folder to
`~/.codex/plugins/gsa-build-kit` and add an entry under `plugins[]` in
`~/.agents/plugins/marketplace.json` with
`"source": { "source": "local", "path": "./.codex/plugins/gsa-build-kit" }`.

To test just the MCP server without the plugin, enable **Developer mode**
(Settings → Security and login), open [ChatGPT Plugins](https://chatgpt.com/plugins),
and add `https://dsgn.up.railway.app/mcp` as a server.

## Publish

Public plugins are submitted through the plugin submission portal. Submit the
remote HTTPS endpoint as **With MCP**; the Build Kit is already public, so no
deployment change is needed. Before submitting, check `version` in
`plugin.json`, the `interface` copy, and the starter prompts.

## Notes

- The server is **read-only** and stateless, so redeploys don't interrupt agents.
- To create designs *inside* Figma the user also connects Figma's official MCP
  (`https://mcp.figma.com/mcp`); this plugin does not bundle it.
