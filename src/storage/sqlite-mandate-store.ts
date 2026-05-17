import type { DatabaseSync } from "node:sqlite";
import type { MandateStore } from "../core/mandates.ts";
import type { Mandate } from "../core/types.ts";
import { decode, encode } from "./codec.ts";

/**
 * SQLite-backed mandate store — a durable, drop-in replacement for
 * {@link import("../core/mandates.ts").InMemoryMandateStore}. A revoked
 * mandate stays revoked across restarts, which is the point.
 */
export class SqliteMandateStore implements MandateStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get(id: string): Mandate | undefined {
    const row = this.db
      .prepare("SELECT data FROM mandates WHERE id = ?")
      .get(id);
    return row ? decode<Mandate>(String(row["data"])) : undefined;
  }

  put(mandate: Mandate): void {
    this.db
      .prepare("INSERT OR REPLACE INTO mandates (id, data) VALUES (?, ?)")
      .run(mandate.id, encode(mandate));
  }

  list(): Mandate[] {
    return this.db
      .prepare("SELECT data FROM mandates ORDER BY id")
      .all()
      .map((row) => decode<Mandate>(String(row["data"])));
  }

  revoke(id: string): boolean {
    const mandate = this.get(id);
    if (!mandate) return false;
    mandate.revoked = true;
    this.put(mandate);
    return true;
  }
}
