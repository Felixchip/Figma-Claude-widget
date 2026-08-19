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

export interface SpecStore {
  init(): Promise<void>;
  list(): Promise<SpecRow[]>;
  get(id: string): Promise<Spec | undefined>;
  create(spec: Spec): Promise<Spec>;
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

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
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
}

export function createStore(): SpecStore {
  if (process.env.DATABASE_URL) {
    console.log("Using Postgres store");
    return new PostgresStore(process.env.DATABASE_URL);
  }
  console.log("DATABASE_URL not set — using in-memory store");
  return new MemoryStore();
}