// Skills served by the MCP server, per OpenAI's bounded SEP-2640 subset
// (io.modelcontextprotocol/skills). The skill files live in the plugin package
// at chatgpt-plugin/skills/, so that folder is the single source of truth: the
// plugin bundles them and the server serves them, with no copies to drift.
//
// OpenAI imports a static snapshot of these at plugin submission time (Scan
// Tools); it does not fetch them at runtime.

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SkillResource = { uri: string; digest: string; text: string; mimeType: string };

export type Skill = {
  name: string;
  uri: string;
  frontmatter: Record<string, string>;
  resources: SkillResource[];
};

// First URI segment. The directory holding SKILL.md must match the skill name.
const NAMESPACE = "gsa-build-kit";
const SKILLS_DIR = path.join(__dirname, "..", "chatgpt-plugin", "skills");

function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return out;
  for (const line of block[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (key) out[key] = value;
  }
  return out;
}

function walk(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

function mimeFor(file: string): string {
  if (file.endsWith(".md")) return "text/markdown";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".yaml") || file.endsWith(".yml")) return "text/yaml";
  return "text/plain";
}

export function loadSkills(): Skill[] {
  let dirs: string[] = [];
  try {
    dirs = fs
      .readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  const skills: Skill[] = [];
  for (const name of dirs) {
    const dir = path.join(SKILLS_DIR, name);
    let files: string[];
    try {
      files = walk(dir).sort();
    } catch {
      continue;
    }
    if (!files.includes("SKILL.md")) continue;

    const resources: SkillResource[] = files.map((rel) => {
      const text = fs.readFileSync(path.join(dir, rel), "utf8");
      return {
        uri: `skill://${NAMESPACE}/${name}/${rel}`,
        digest: "sha256:" + createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex"),
        text,
        mimeType: mimeFor(rel),
      };
    });

    const skillMd = resources.find((r) => r.uri.endsWith("/SKILL.md"));
    if (!skillMd) continue;

    skills.push({
      name,
      uri: skillMd.uri,
      frontmatter: parseFrontmatter(skillMd.text),
      resources,
    });
  }
  return skills;
}

// The catalog entry shape OpenAI expects from skills/list and skills/get.
export function skillCatalogEntry(skill: Skill) {
  return {
    uri: skill.uri,
    frontmatter: skill.frontmatter,
    resources: skill.resources.map((r) => ({ uri: r.uri, digest: r.digest })),
  };
}
