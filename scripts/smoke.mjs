#!/usr/bin/env node
// Post-deploy smoke test. Exercises the paths a user actually hits, so a bad
// deploy fails loudly here instead of silently in someone's chat.
//
//   npm run smoke                                  # against localhost:3000
//   npm run smoke -- https://dsgn.up.railway.app   # against a deployment
//
// Exits non-zero on the first failure.

const BASE = (process.argv[2] || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MCP = `${BASE}/mcp`;

let failures = 0;
const ok = (label, detail = "") => console.log(`  ok    ${label}${detail ? `  ${detail}` : ""}`);
const bad = (label, detail = "") => {
  failures++;
  console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`);
};

async function rpc(method, params, id = 1) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  // Stateless server replies with JSON, but tolerate an SSE-framed body.
  const match = text.match(/data: (\{.*\})/s);
  const json = JSON.parse(match ? match[1] : text);
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function check(label, fn) {
  try {
    const detail = await fn();
    ok(label, detail ?? "");
  } catch (err) {
    bad(label, err.message);
  }
}

console.log(`Smoke test against ${BASE}\n`);

await check("GET /health", async () => {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return `HTTP ${res.status}`;
});

await check("GET /api/status", async () => {
  const res = await fetch(`${BASE}/api/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  if (!d.configured) throw new Error("repo not configured (GITHUB_REPO)");
  if (!d.figma?.connected) throw new Error("Figma not connected");
  return `v${d.version} · repo ${d.repo} · library ${d.library?.total ?? 0} images`;
});

await check("MCP initialize", async () => {
  const r = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1" },
  });
  if (r.serverInfo?.name !== "gsa-build-kit") throw new Error(`unexpected server ${r.serverInfo?.name}`);
  const hasSkills = !!r.capabilities?.extensions?.["io.modelcontextprotocol/skills"];
  return `v${r.serverInfo.version} · skills ${hasSkills ? "on" : "OFF"}`;
});

await check("MCP tools/list", async () => {
  const r = await rpc("tools/list", {});
  const n = r.tools?.length ?? 0;
  if (n < 10) throw new Error(`only ${n} tools`);
  return `${n} tools`;
});

await check("MCP tools/call list_rules", async () => {
  const r = await rpc("tools/call", { name: "list_rules", arguments: {} });
  const text = r.content?.[0]?.text ?? "";
  if (text.length < 500) throw new Error(`unexpectedly short (${text.length} chars)`);
  if (!/READ-ONLY/i.test(text)) throw new Error("rules text looks stale");
  return `${text.length} chars`;
});

await check("MCP skills/list", async () => {
  const r = await rpc("skills/list", {});
  const n = r.skills?.length ?? 0;
  if (!n) throw new Error("no skills served");
  return `${n} skill(s): ${r.skills.map((s) => s.frontmatter?.name).join(", ")}`;
});

await check("MCP tools/call get_figma_library", async () => {
  const r = await rpc("tools/call", { name: "get_figma_library", arguments: {} });
  const text = r.content?.[0]?.text ?? "";
  if (r.isError) throw new Error(text.slice(0, 120));
  return text.length ? `${text.length} chars` : "ok";
});

await check("GET /api/figma/images", async () => {
  const res = await fetch(`${BASE}/api/figma/images`);
  const d = await res.json();
  const n = d.images?.length ?? 0;
  if (!n) throw new Error("no rendered images");
  const themes = [...new Set(d.images.map((i) => i.theme || "default"))];
  return `${n} images · ${themes.join(", ")}`;
});

await check("GET /api/figma/image/:nodeId", async () => {
  const list = await (await fetch(`${BASE}/api/figma/images`)).json();
  const first = list.images?.[0];
  if (!first) throw new Error("nothing to fetch");
  const url = `${BASE}/api/figma/image/${encodeURIComponent(first.nodeId)}${first.theme ? `?theme=${encodeURIComponent(first.theme)}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error(`content-type ${type}`);
  return `${first.group} · ${type}`;
});

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
