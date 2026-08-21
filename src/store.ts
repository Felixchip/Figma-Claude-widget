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
  init(): Promise<void>;
  list(): Promise<SpecRow[]>;
  get(id: string): Promise<Spec | undefined>;
  create(spec: Spec): Promise<Spec>;
  getFigmaSettings(): Promise<FigmaSettings | undefined>;
  saveFigmaSettings(s: FigmaSettings): Promise<void>;
  updateFigmaFileName(fileName: string): Promise<void>;
  clearFigmaSettings(): Promise<void>;
}

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
}

export function createStore(): SpecStore {
  if (process.env.DATABASE_URL) {
    console.log("Using Postgres store");
    return new PostgresStore(process.env.DATABASE_URL);
  }
  console.log("DATABASE_URL not set, using in-memory store");
  return new MemoryStore();
}