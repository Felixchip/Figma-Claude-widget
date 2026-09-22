import pg from "pg";
import type { RenderTarget } from "./figma.js";

const { Pool } = pg;

export type Spec = {
  id: string;
  nodeId: string;
  purpose: string;
  actions: string;
  states: string;
  rules: string;
  data: string;
  navigation: string;
  acceptance: string;
  createdAt: string;
  updatedAt: string;
};

export type SpecRow = Pick<Spec, "id" | "nodeId" | "updatedAt">;

export type FigmaSettings = {
  token: string;
  fileKey: string;
  fileName: string;
  userName: string;
  connectedAt: string;
};

export interface SpecStore {
  ready: boolean;
  readonly kind: "postgres" | "memory";
  init(): Promise<void>;
  list(): Promise<SpecRow[]>;
  get(id: string): Promise<Spec | undefined>;
  create(spec: Spec): Promise<Spec>;
  getFigmaSettings(): Promise<FigmaSettings | undefined>;
  saveFigmaSettings(s: FigmaSettings): Promise<void>;
  updateFigmaFileName(fileName: string): Promise<void>;
  clearFigmaSettings(): Promise<void>;
  getUsageRules(): Promise<string | undefined>;
  saveUsageRules(rules: string): Promise<void>;
  getFoundation(): Promise<string | undefined>;
  saveFoundation(foundation: string): Promise<void>;
  getRenderGuide(): Promise<string | undefined>;
  saveRenderGuide(guide: string): Promise<void>;
  getRegistry(): Promise<unknown[]>;
  saveRegistry(entries: unknown[]): Promise<void>;
  getAliases(): Promise<unknown[]>;
  saveAliases(aliases: unknown[]): Promise<void>;
  getPreferredTheme(): Promise<string>;
  setPreferredTheme(theme: string): Promise<void>;
  logUsage(event: { tool: string; detail?: string; source?: string }): Promise<void>;
  usageStats(days?: number): Promise<UsageStats>;
  logAudit(event: Omit<AuditEvent, "at">): Promise<void>;
  auditEvents(limit?: number): Promise<AuditEvent[]>;
  getImage(nodeId: string, theme?: string): Promise<ComponentImage | undefined>;
  saveImage(img: ComponentImage): Promise<void>;
  listImages(): Promise<ComponentImageMeta[]>;
  imageStats(): Promise<{ total: number; themes: { theme: string; count: number }[] }>;
  deleteImage(nodeId: string, theme?: string): Promise<void>;
  clearImages(): Promise<void>;
  saveTargets(targets: RenderTarget[], fileVersion: string): Promise<void>;
  getTargets(): Promise<{ targets: RenderTarget[]; fileVersion: string } | undefined>;
}

export type ComponentImage = {
  nodeId: string;
  theme: string;
  fileKey: string;
  fileVersion: string;
  name: string;
  group: string;
  mime: string;
  data: Buffer;
  fetchedAt: string;
};

export type ComponentImageMeta = Omit<ComponentImage, "data"> & { bytes: number };

export type UsageStats = {
  days: number;
  total: number;
  tools: { tool: string; count: number }[];
  recent: { tool: string; detail: string; source: string; at: string }[];
};

export type AuditEvent = {
  at: string;
  actor: string;
  action: string;
  target: string;
  summary: string;
  source: string;
  ip: string;
};

function toSpec(row: any): Spec {
  return {
    id: row.id,
    nodeId: row.node_id ?? "",
    purpose: row.purpose ?? "",
    actions: row.actions ?? "",
    states: row.states ?? "",
    rules: row.rules ?? "",
    data: row.data ?? "",
    navigation: row.navigation ?? "",
    acceptance: row.acceptance ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class PostgresStore implements SpecStore {
  private pool: pg.Pool;
  readonly kind = "postgres" as const;
  ready = false;

  constructor(connectionString: string) {
    const ssl = process.env.PGSSL === "true";
    this.pool = new Pool({
      connectionString,
      ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS specs (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL DEFAULT '',
        purpose TEXT NOT NULL DEFAULT '',
        actions TEXT NOT NULL DEFAULT '',
        states TEXT NOT NULL DEFAULT '',
        rules TEXT NOT NULL DEFAULT '',
        data TEXT NOT NULL DEFAULT '',
        navigation TEXT NOT NULL DEFAULT '',
        acceptance TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS component_images (
        node_id TEXT NOT NULL,
        theme TEXT NOT NULL DEFAULT '',
        file_key TEXT NOT NULL DEFAULT '',
        file_version TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        group_name TEXT NOT NULL DEFAULT '',
        mime TEXT NOT NULL DEFAULT 'image/png',
        data BYTEA NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (node_id, theme)
      )
    `);
    // Migration for installs created before themes existed.
    await this.pool.query(`ALTER TABLE component_images ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT ''`);
    await this.pool.query(`ALTER TABLE component_images DROP CONSTRAINT IF EXISTS component_images_pkey`);
    await this.pool.query(`ALTER TABLE component_images ADD PRIMARY KEY (node_id, theme)`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id BIGSERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL DEFAULT now(),
        tool TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT ''
      )
    `);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS usage_events_at_idx ON usage_events (at DESC)`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id BIGSERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL DEFAULT now(),
        actor TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        ip TEXT NOT NULL DEFAULT ''
      )
    `);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS audit_events_at_idx ON audit_events (at DESC)`);
    this.ready = true;
  }

  private async getSetting(key: string): Promise<string | undefined> {
    const res = await this.pool.query("SELECT value FROM settings WHERE key = $1", [key]);
    return res.rows[0]?.value;
  }

  private async setSetting(key: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value]
    );
  }

  async getFigmaSettings(): Promise<FigmaSettings | undefined> {
    const token = await this.getSetting("figma_token");
    if (!token) return undefined;
    const fileKey = (await this.getSetting("figma_file_key")) ?? "";
    const fileName = (await this.getSetting("figma_file_name")) ?? "";
    const userName = (await this.getSetting("figma_user_name")) ?? "";
    const connectedAt = (await this.getSetting("figma_connected_at")) ?? "";
    return { token, fileKey, fileName, userName, connectedAt };
  }

  async saveFigmaSettings(s: FigmaSettings): Promise<void> {
    await this.setSetting("figma_token", s.token);
    await this.setSetting("figma_file_key", s.fileKey);
    await this.setSetting("figma_file_name", s.fileName);
    await this.setSetting("figma_user_name", s.userName);
    await this.setSetting("figma_connected_at", s.connectedAt);
  }

  async clearFigmaSettings(): Promise<void> {
    for (const key of ["figma_token", "figma_file_key", "figma_file_name", "figma_user_name", "figma_connected_at"]) {
      await this.pool.query("DELETE FROM settings WHERE key = $1", [key]);
    }
  }

  async updateFigmaFileName(fileName: string): Promise<void> {
    await this.setSetting("figma_file_name", fileName);
  }

  async getUsageRules(): Promise<string | undefined> {
    return this.getSetting("usage_rules");
  }

  async getPreferredTheme(): Promise<string> {
    return (await this.getSetting("preferred_theme")) ?? "";
  }

  async setPreferredTheme(theme: string): Promise<void> {
    await this.setSetting("preferred_theme", theme);
  }

  async logUsage(event: { tool: string; detail?: string; source?: string }): Promise<void> {
    await this.pool.query(
      "INSERT INTO usage_events (tool, detail, source) VALUES ($1, $2, $3)",
      [event.tool.slice(0, 120), (event.detail ?? "").slice(0, 200), (event.source ?? "").slice(0, 60)]
    );
  }

  async usageStats(days = 7): Promise<UsageStats> {
    const tools = await this.pool.query(
      `SELECT tool, count(*)::int AS count FROM usage_events
        WHERE at > now() - ($1 || ' days')::interval
        GROUP BY tool ORDER BY count DESC LIMIT 25`,
      [String(days)]
    );
    const total = await this.pool.query(
      `SELECT count(*)::int AS count FROM usage_events WHERE at > now() - ($1 || ' days')::interval`,
      [String(days)]
    );
    const recent = await this.pool.query(
      `SELECT tool, detail, source, at FROM usage_events ORDER BY at DESC LIMIT 25`
    );
    return {
      days,
      total: Number(total.rows[0]?.count ?? 0),
      tools: tools.rows.map((r) => ({ tool: r.tool, count: Number(r.count) })),
      recent: recent.rows.map((r) => ({
        tool: r.tool,
        detail: r.detail ?? "",
        source: r.source ?? "",
        at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
      })),
    };
  }

  async logAudit(event: Omit<AuditEvent, "at">): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_events (actor, action, target, summary, source, ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.actor.slice(0, 80),
        event.action.slice(0, 80),
        event.target.slice(0, 120),
        event.summary.slice(0, 300),
        event.source.slice(0, 20),
        event.ip.slice(0, 60),
      ]
    );
  }

  async auditEvents(limit = 200): Promise<AuditEvent[]> {
    const res = await this.pool.query(
      `SELECT at, actor, action, target, summary, source, ip
         FROM audit_events ORDER BY at DESC LIMIT $1`,
      [Math.min(1000, Math.max(1, limit))]
    );
    return res.rows.map((r) => ({
      at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
      actor: r.actor ?? "",
      action: r.action ?? "",
      target: r.target ?? "",
      summary: r.summary ?? "",
      source: r.source ?? "",
      ip: r.ip ?? "",
    }));
  }

  async saveUsageRules(rules: string): Promise<void> {
    await this.setSetting("usage_rules", rules);
  }

  async getFoundation(): Promise<string | undefined> {
    return this.getSetting("system_foundation");
  }

  async saveFoundation(foundation: string): Promise<void> {
    await this.setSetting("system_foundation", foundation);
  }

  async getRenderGuide(): Promise<string | undefined> {
    return this.getSetting("render_guide");
  }

  async saveRenderGuide(guide: string): Promise<void> {
    await this.setSetting("render_guide", guide);
  }

  async getRegistry(): Promise<unknown[]> {
    const raw = await this.getSetting("component_registry");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async saveRegistry(entries: unknown[]): Promise<void> {
    await this.setSetting("component_registry", JSON.stringify(entries));
  }

  async getAliases(): Promise<unknown[]> {
    const raw = await this.getSetting("component_aliases");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async saveAliases(aliases: unknown[]): Promise<void> {
    await this.setSetting("component_aliases", JSON.stringify(aliases));
  }

  async getImage(nodeId: string, theme = ""): Promise<ComponentImage | undefined> {
    const res = await this.pool.query("SELECT * FROM component_images WHERE node_id = $1 AND theme = $2", [nodeId, theme]);
    if (res.rows.length === 0) return undefined;
    const r = res.rows[0];
    return {
      nodeId: r.node_id,
      theme: r.theme ?? "",
      fileKey: r.file_key,
      fileVersion: r.file_version,
      name: r.name,
      group: r.group_name,
      mime: r.mime,
      data: r.data,
      fetchedAt: r.fetched_at,
    };
  }

  async saveImage(img: ComponentImage): Promise<void> {
    await this.pool.query(
      `INSERT INTO component_images (node_id, theme, file_key, file_version, name, group_name, mime, data, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (node_id, theme) DO UPDATE SET
         file_key = EXCLUDED.file_key,
         file_version = EXCLUDED.file_version,
         name = EXCLUDED.name,
         group_name = EXCLUDED.group_name,
         mime = EXCLUDED.mime,
         data = EXCLUDED.data,
         fetched_at = EXCLUDED.fetched_at`,
      [img.nodeId, img.theme ?? "", img.fileKey, img.fileVersion, img.name, img.group, img.mime, img.data, img.fetchedAt]
    );
  }

  async listImages(): Promise<ComponentImageMeta[]> {
    const res = await this.pool.query(
      "SELECT node_id, theme, file_key, file_version, name, group_name, mime, fetched_at, octet_length(data) AS bytes FROM component_images ORDER BY group_name, name, theme"
    );
    return res.rows.map((r) => ({
      nodeId: r.node_id,
      theme: r.theme ?? "",
      fileKey: r.file_key,
      fileVersion: r.file_version,
      name: r.name,
      group: r.group_name,
      mime: r.mime,
      fetchedAt: r.fetched_at,
      bytes: Number(r.bytes),
    }));
  }

  async clearImages(): Promise<void> {
    await this.pool.query("DELETE FROM component_images");
  }

  async imageStats(): Promise<{ total: number; themes: { theme: string; count: number }[] }> {
    const res = await this.pool.query(
      "SELECT theme, count(*)::int AS count FROM component_images GROUP BY theme ORDER BY theme"
    );
    const themes = res.rows.map((r) => ({ theme: r.theme ?? "", count: Number(r.count) }));
    return { total: themes.reduce((n, t) => n + t.count, 0), themes };
  }

  async deleteImage(nodeId: string, theme = ""): Promise<void> {
    await this.pool.query("DELETE FROM component_images WHERE node_id = $1 AND theme = $2", [nodeId, theme]);
  }

  async saveTargets(targets: RenderTarget[], fileVersion: string): Promise<void> {
    await this.setSetting("render_targets", JSON.stringify({ fileVersion, targets }));
  }

  async getTargets(): Promise<{ targets: RenderTarget[]; fileVersion: string } | undefined> {
    const raw = await this.getSetting("render_targets");
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.targets)) return parsed;
      return undefined;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<SpecRow[]> {
    const res = await this.pool.query(
      "SELECT id, node_id, updated_at FROM specs ORDER BY updated_at DESC"
    );
    return res.rows.map((r) => ({
      id: r.id,
      nodeId: r.node_id ?? "",
      updatedAt: r.updated_at,
    }));
  }

  async get(id: string): Promise<Spec | undefined> {
    const res = await this.pool.query("SELECT * FROM specs WHERE id = $1", [id]);
    if (res.rows.length === 0) return undefined;
    return toSpec(res.rows[0]);
  }

  async create(spec: Spec): Promise<Spec> {
    await this.pool.query(
      `INSERT INTO specs (
        id, node_id, purpose, actions, states, rules, data, navigation, acceptance, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        spec.id,
        spec.nodeId,
        spec.purpose,
        spec.actions,
        spec.states,
        spec.rules,
        spec.data,
        spec.navigation,
        spec.acceptance,
        spec.createdAt,
        spec.updatedAt,
      ]
    );
    return spec;
  }
}

class MemoryStore implements SpecStore {
  private specs = new Map<string, Spec>();
  private settings = new Map<string, string>();
  private images = new Map<string, ComponentImage>();
  private targets?: { targets: RenderTarget[]; fileVersion: string };
  private usage: { tool: string; detail: string; source: string; at: string }[] = [];
  private audit: AuditEvent[] = [];
  readonly kind = "memory" as const;
  ready = true;

  async init(): Promise<void> {}

  async list(): Promise<SpecRow[]> {
    return [...this.specs.values()]
      .map((s) => ({ id: s.id, nodeId: s.nodeId, updatedAt: s.updatedAt }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async get(id: string): Promise<Spec | undefined> {
    return this.specs.get(id);
  }

  async create(spec: Spec): Promise<Spec> {
    this.specs.set(spec.id, spec);
    return spec;
  }

  async getFigmaSettings(): Promise<FigmaSettings | undefined> {
    const token = this.settings.get("figma_token");
    if (!token) return undefined;
    return {
      token,
      fileKey: this.settings.get("figma_file_key") ?? "",
      fileName: this.settings.get("figma_file_name") ?? "",
      userName: this.settings.get("figma_user_name") ?? "",
      connectedAt: this.settings.get("figma_connected_at") ?? "",
    };
  }

  async saveFigmaSettings(s: FigmaSettings): Promise<void> {
    this.settings.set("figma_token", s.token);
    this.settings.set("figma_file_key", s.fileKey);
    this.settings.set("figma_file_name", s.fileName);
    this.settings.set("figma_user_name", s.userName);
    this.settings.set("figma_connected_at", s.connectedAt);
  }

  async clearFigmaSettings(): Promise<void> {
    for (const key of ["figma_token", "figma_file_key", "figma_file_name", "figma_user_name", "figma_connected_at"]) {
      this.settings.delete(key);
    }
  }

  async updateFigmaFileName(fileName: string): Promise<void> {
    this.settings.set("figma_file_name", fileName);
  }

  async getUsageRules(): Promise<string | undefined> {
    return this.settings.get("usage_rules");
  }

  async saveUsageRules(rules: string): Promise<void> {
    this.settings.set("usage_rules", rules);
  }

  async getFoundation(): Promise<string | undefined> {
    return this.settings.get("system_foundation");
  }

  async saveFoundation(foundation: string): Promise<void> {
    this.settings.set("system_foundation", foundation);
  }

  async getRenderGuide(): Promise<string | undefined> {
    return this.settings.get("render_guide");
  }

  async saveRenderGuide(guide: string): Promise<void> {
    this.settings.set("render_guide", guide);
  }

  async getRegistry(): Promise<unknown[]> {
    const raw = this.settings.get("component_registry");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async saveRegistry(entries: unknown[]): Promise<void> {
    this.settings.set("component_registry", JSON.stringify(entries));
  }

  async getAliases(): Promise<unknown[]> {
    const raw = this.settings.get("component_aliases");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async saveAliases(aliases: unknown[]): Promise<void> {
    this.settings.set("component_aliases", JSON.stringify(aliases));
  }

  async getPreferredTheme(): Promise<string> {
    return this.settings.get("preferred_theme") ?? "";
  }

  async setPreferredTheme(theme: string): Promise<void> {
    this.settings.set("preferred_theme", theme);
  }

  async logUsage(event: { tool: string; detail?: string; source?: string }): Promise<void> {
    this.usage.unshift({
      tool: event.tool,
      detail: event.detail ?? "",
      source: event.source ?? "",
      at: new Date().toISOString(),
    });
    if (this.usage.length > 2000) this.usage.length = 2000;
  }

  async usageStats(days = 7): Promise<UsageStats> {
    const since = Date.now() - days * 86_400_000;
    const inWindow = this.usage.filter((e) => Date.parse(e.at) > since);
    const counts = new Map<string, number>();
    for (const e of inWindow) counts.set(e.tool, (counts.get(e.tool) ?? 0) + 1);
    return {
      days,
      total: inWindow.length,
      tools: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([tool, count]) => ({ tool, count })),
      recent: this.usage.slice(0, 25),
    };
  }

  async logAudit(event: Omit<AuditEvent, "at">): Promise<void> {
    this.audit.unshift({ ...event, at: new Date().toISOString() });
    if (this.audit.length > 2000) this.audit.length = 2000;
  }

  async auditEvents(limit = 200): Promise<AuditEvent[]> {
    return this.audit.slice(0, Math.min(1000, Math.max(1, limit)));
  }

  async getImage(nodeId: string, theme = ""): Promise<ComponentImage | undefined> {
    return this.images.get(`${nodeId}\u0000${theme}`);
  }

  async saveImage(img: ComponentImage): Promise<void> {
    this.images.set(`${img.nodeId}\u0000${img.theme ?? ""}`, img);
  }

  async listImages(): Promise<ComponentImageMeta[]> {
    return [...this.images.values()].map((img) => ({
      nodeId: img.nodeId,
      theme: img.theme ?? "",
      fileKey: img.fileKey,
      fileVersion: img.fileVersion,
      name: img.name,
      group: img.group,
      mime: img.mime,
      fetchedAt: img.fetchedAt,
      bytes: img.data.length,
    }));
  }

  async clearImages(): Promise<void> {
    this.images.clear();
  }

  async imageStats(): Promise<{ total: number; themes: { theme: string; count: number }[] }> {
    const counts = new Map<string, number>();
    for (const img of this.images.values()) {
      const t = img.theme ?? "";
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const themes = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([theme, count]) => ({ theme, count }));
    return { total: themes.reduce((n, t) => n + t.count, 0), themes };
  }

  async deleteImage(nodeId: string, theme = ""): Promise<void> {
    this.images.delete(`${nodeId}\u0000${theme}`);
  }

  async saveTargets(targets: RenderTarget[], fileVersion: string): Promise<void> {
    this.targets = { targets, fileVersion };
  }

  async getTargets(): Promise<{ targets: RenderTarget[]; fileVersion: string } | undefined> {
    return this.targets;
  }
}

export function createStore(): SpecStore {
  if (process.env.DATABASE_URL) {
    console.log("Using Postgres store");
    return new PostgresStore(process.env.DATABASE_URL);
  }
  console.log("DATABASE_URL not set, using in-memory store");
  return new MemoryStore();
}