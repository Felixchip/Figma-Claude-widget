import pg from "pg";

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
  getImage(nodeId: string): Promise<ComponentImage | undefined>;
  saveImage(img: ComponentImage): Promise<void>;
  listImages(): Promise<ComponentImageMeta[]>;
  deleteImage(nodeId: string): Promise<void>;
  clearImages(): Promise<void>;
}

export type ComponentImage = {
  nodeId: string;
  fileKey: string;
  fileVersion: string;
  name: string;
  group: string;
  mime: string;
  data: Buffer;
  fetchedAt: string;
};

export type ComponentImageMeta = Omit<ComponentImage, "data"> & { bytes: number };

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
        node_id TEXT PRIMARY KEY,
        file_key TEXT NOT NULL DEFAULT '',
        file_version TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        group_name TEXT NOT NULL DEFAULT '',
        mime TEXT NOT NULL DEFAULT 'image/png',
        data BYTEA NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL
      )
    `);
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

  async getImage(nodeId: string): Promise<ComponentImage | undefined> {
    const res = await this.pool.query("SELECT * FROM component_images WHERE node_id = $1", [nodeId]);
    if (res.rows.length === 0) return undefined;
    const r = res.rows[0];
    return {
      nodeId: r.node_id,
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
      `INSERT INTO component_images (node_id, file_key, file_version, name, group_name, mime, data, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (node_id) DO UPDATE SET
         file_key = EXCLUDED.file_key,
         file_version = EXCLUDED.file_version,
         name = EXCLUDED.name,
         group_name = EXCLUDED.group_name,
         mime = EXCLUDED.mime,
         data = EXCLUDED.data,
         fetched_at = EXCLUDED.fetched_at`,
      [img.nodeId, img.fileKey, img.fileVersion, img.name, img.group, img.mime, img.data, img.fetchedAt]
    );
  }

  async listImages(): Promise<ComponentImageMeta[]> {
    const res = await this.pool.query(
      "SELECT node_id, file_key, file_version, name, group_name, mime, fetched_at, octet_length(data) AS bytes FROM component_images ORDER BY group_name, name"
    );
    return res.rows.map((r) => ({
      nodeId: r.node_id,
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

  async deleteImage(nodeId: string): Promise<void> {
    await this.pool.query("DELETE FROM component_images WHERE node_id = $1", [nodeId]);
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

  async getImage(nodeId: string): Promise<ComponentImage | undefined> {
    return this.images.get(nodeId);
  }

  async saveImage(img: ComponentImage): Promise<void> {
    this.images.set(img.nodeId, img);
  }

  async listImages(): Promise<ComponentImageMeta[]> {
    return [...this.images.values()].map((img) => ({
      nodeId: img.nodeId,
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

  async deleteImage(nodeId: string): Promise<void> {
    this.images.delete(nodeId);
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