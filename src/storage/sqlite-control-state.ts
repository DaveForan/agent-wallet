import type { DatabaseSync } from "node:sqlite";
import type { ControlState, FreezeStatus } from "../core/control.ts";

/**
 * SQLite-backed control state — a freeze survives a restart. A kill-switch
 * that forgot it had been pulled would be a dangerous kill-switch.
 *
 * The `wallet_control` table holds exactly one row (id = 1), created by
 * {@link import("./db.ts").openWalletDatabase}.
 */
export class SqliteControlState implements ControlState {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  status(): FreezeStatus {
    const row = this.db
      .prepare(
        "SELECT frozen, freeze_reason, changed_at FROM wallet_control " +
          "WHERE id = 1",
      )
      .get();
    if (!row) return { frozen: false };
    const reason = row["freeze_reason"];
    const changedAt = row["changed_at"];
    return {
      frozen: Number(row["frozen"]) === 1,
      reason: reason == null ? undefined : String(reason),
      changedAt: changedAt == null ? undefined : String(changedAt),
    };
  }

  freeze(reason: string): void {
    this.db
      .prepare(
        "UPDATE wallet_control SET frozen = 1, freeze_reason = ?, " +
          "changed_at = ? WHERE id = 1",
      )
      .run(reason, new Date().toISOString());
  }

  unfreeze(): void {
    this.db
      .prepare(
        "UPDATE wallet_control SET frozen = 0, freeze_reason = NULL, " +
          "changed_at = ? WHERE id = 1",
      )
      .run(new Date().toISOString());
  }
}
