import type { DatabaseSync } from "node:sqlite";
import type { FundingSource, FundingSourceStore } from "../core/funding.ts";
import { decode, encode } from "./codec.ts";

/**
 * SQLite-backed funding-source store — the wallet's registered payment method
 * survives a restart. The `funding_source` table holds exactly one row
 * (id = 1), created by {@link import("./db.ts").openWalletDatabase}.
 */
export class SqliteFundingSourceStore implements FundingSourceStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get(): FundingSource | undefined {
    const row = this.db
      .prepare("SELECT data FROM funding_source WHERE id = 1")
      .get();
    const data = row?.["data"];
    return data == null ? undefined : decode<FundingSource>(String(data));
  }

  set(source: FundingSource): void {
    this.db
      .prepare("UPDATE funding_source SET data = ? WHERE id = 1")
      .run(encode(source));
  }

  clear(): void {
    this.db.prepare("UPDATE funding_source SET data = NULL WHERE id = 1").run();
  }
}
