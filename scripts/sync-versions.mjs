// Keep every manifest in step with package.json, which is the single source of
// truth. Run by `npm run pack:plugin` so archives never ship a stale version.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

const targets = [
  "chatgpt-plugin/plugin.json",
  "chatgpt-plugin/.codex-plugin/plugin.json",
];

let changed = 0;
for (const rel of targets) {
  const file = path.join(root, rel);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  if (json.version === version) {
    console.log(`  = ${rel} (${version})`);
    continue;
  }
  console.log(`  → ${rel}: ${json.version} -> ${version}`);
  json.version = version;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  changed++;
}

console.log(changed ? `Synced ${changed} manifest(s) to ${version}.` : `All manifests at ${version}.`);
