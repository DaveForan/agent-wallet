import type { DatabaseSync } from "node:sqlite";
import type { Ledger, LedgerEvent, LedgerEventType } from "../core/ledger.ts";
import { decode, encode } from "./codec.ts";

/**
 * SQLite-backed audit ledger — a durable, drop-in replacement for
 * {@link import("../core/ledger.ts").InMemoryLedger}. The append-only
 * guarantee is structural: this class only ever INSERTs.
 */
export class SqliteLedger implements Ledger {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  append(
    type: LedgerEventType,
    data: Record<string, unknown>,
    paymentId?: string,
  ): LedgerEvent {
    const at = new Date().toISOString();
    const changes = this.db
      .prepare(
        "INSERT INTO ledger_events (at, type, payment_id, data) " +
          "VALUES (?, ?, ?, ?)",
      )
      .run(at, type, paymentId ?? null, encode(data));
    return { seq: Number(changes.lastInsertRowid), at, type, paymentId, data };
  }

  history(paymentId?: string): LedgerEvent[] {
    const rows =
      paymentId === undefined
        ? this.db
            .prepare(
              "SELECT seq, at, type, payment_id, data FROM ledger_events " +
                "ORDER BY seq",
            )
            .all()
        : this.db
            .prepare(
              "SELECT seq, at, type, payment_id, data FROM ledger_events " +
                "WHERE payment_id = ? ORDER BY seq",
            )
            .all(paymentId);
    return rows.map((row) => this.toEvent(row));
  }

  private toEvent(row: Record<string, unknown>): LedgerEvent {
    const paymentId = row["payment_id"];
    return {
      seq: Number(row["seq"]),
      at: String(row["at"]),
      type: String(row["type"]) as LedgerEventType,
      paymentId:
        paymentId === null || paymentId === undefined
          ? undefined
          : String(paymentId),
      data: decode<Record<string, unknown>>(String(row["data"])),
    };
  }
}
