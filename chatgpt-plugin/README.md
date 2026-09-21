# GSA Build Kit — ChatGPT / Codex plugin

Packages the GSA Build Kit MCP server plus a skill, so ChatGPT and Codex know
how to use it: start with the rules and library, then design in Figma, build
SwiftUI, or render a mockup.

## Contents

```
chatgpt-plugin/
├── .codex-plugin/plugin.json       compatibility manifest (what local hosts load)
├── .mcp.json                       bundled MCP server (compatibility layout)
├── plugin.json                     portable manifest (Agent Plugins schema)
├── mcp.json                        bundled MCP server (portable layout)
├── skills/gsa-build-kit/SKILL.md   the workflow instructions
├── assets/icon.png
└── README.md
```

Both manifest layouts are present on purpose. Local hosts (the ChatGPT desktop
app, Codex) load the `.codex-plugin/plugin.json` compatibility manifest, which
is why a package with only the portable `plugin.json` is rejected with
*"marketplace root does not contain a supported manifest"*. The portable
`plugin.json` + `mcp.json` are for public submission.

`plugin.json` carries the OpenAI presentation under `extensions.com.openai`
(display name, category, brand colour, icon, starter prompts). The MCP server
is the deployed Build Kit at `https://dsgn.up.railway.app/mcp`; change the URL
in `mcp.json` if you deploy elsewhere.

## The skill is served by the MCP

The skill is not only bundled here: the Build Kit MCP serves it too, so it
always travels with the server. The server advertises OpenAI's
`io.modelcontextprotocol/skills` extension and implements `skills/list`,
`skills/get` and `resources/read`, reading the files from
`chatgpt-plugin/skills/` (this folder is the single source of truth, so there is
nothing to keep in sync).

During plugin submission, **Scan Tools** imports a static snapshot of the
skills from the server into the draft. After changing a skill, run **Scan
Tools** again and submit a new plugin version.

## Test it locally

The repo ships a marketplace at `.agents/plugins/marketplace.json` that points
at `./chatgpt-plugin`. Add the **marketplace root**, which is the repo root, not
the plugin folder:

```sh
codex plugin marketplace add .          # run from the repo root
codex plugin marketplace list
```

Then:

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

## Archives

Build the uploadable zips with:

```sh
npm run pack:plugin
```

That writes:

| Archive | Contents | Use |
| ------- | -------- | --- |
| `artifacts/gsa-build-kit-plugin.zip` | the whole plugin, wrapped in `gsa-build-kit/` | sharing or archiving the package |
| `artifacts/gsa-build-kit-skill.zip` | `gsa-build-kit/SKILL.md` | the **Skills** tab in the submission portal |

Both exclude `node_modules`, `dist` and `.DS_Store`. The plugin archive keeps
the hidden files (`.codex-plugin/plugin.json`, `.mcp.json`), so unzip with the
usual flags if you extract it manually.

## Publish

Public plugins are submitted through the plugin submission portal. Submit the
remote HTTPS endpoint as **With MCP**; the Build Kit is already public, so no
deployment change is needed. Before submitting, check `version` in
`plugin.json`, the `interface` copy, and the starter prompts.

## Notes

- The server is **read-only** and stateless, so redeploys don't interrupt agents.
- To create designs *inside* Figma the user also connects Figma's official MCP
  (`https://mcp.figma.com/mcp`); this plugin does not bundle it.
