import type { DatabaseSync } from "node:sqlite";
import type { Agent, AgentStore } from "../core/agents.ts";

/** SQLite-backed agent registry — survives a restart. */
export class SqliteAgentStore implements AgentStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  put(agent: Agent): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO agents (id, token_hash, label, created_at) " +
          "VALUES (?, ?, ?, ?)",
      )
      .run(agent.id, agent.tokenHash, agent.label ?? null, agent.createdAt);
  }

  get(id: string): Agent | undefined {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
    return row ? toAgent(row) : undefined;
  }

  list(): Agent[] {
    return this.db
      .prepare("SELECT * FROM agents ORDER BY created_at")
      .all()
      .map(toAgent);
  }

  remove(id: string): boolean {
    return this.db.prepare("DELETE FROM agents WHERE id = ?").run(id).changes > 0;
  }

  findByTokenHash(tokenHash: string): Agent | undefined {
    const row = this.db
      .prepare("SELECT * FROM agents WHERE token_hash = ?")
      .get(tokenHash);
    return row ? toAgent(row) : undefined;
  }
}

function toAgent(row: Record<string, unknown>): Agent {
  const label = row["label"];
  return {
    id: String(row["id"]),
    tokenHash: String(row["token_hash"]),
    label: label == null ? undefined : String(label),
    createdAt: String(row["created_at"]),
  };
}
