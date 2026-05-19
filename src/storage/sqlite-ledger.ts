import type { DatabaseSync } from "node:sqlite";
import {
  GENESIS_HASH,
  checkChain,
  hashLedgerEvent,
  type Ledger,
  type LedgerEvent,
  type LedgerEventType,
  type LedgerIntegrity,
} from "../core/ledger.ts";
import { decode, encode } from "./codec.ts";

const COLUMNS = "seq, at, type, payment_id, data, hash";

/**
 * SQLite-backed audit ledger — a durable, drop-in replacement for
 * {@link import("../core/ledger.ts").InMemoryLedger}. The append-only
 * guarantee is structural (only INSERTs), and every event is hash-chained so
 * tampering with the stored file is detectable via `verifyIntegrity()`.
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
    // The hash chains to the previous event; the seq is assigned here (rather
    // than via AUTOINCREMENT) so it can be hashed before the row is written.
    const prev = this.db
      .prepare("SELECT seq, hash FROM ledger_events ORDER BY seq DESC LIMIT 1")
      .get();
    const seq = prev ? Number(prev["seq"]) + 1 : 1;
    const prevHash = prev ? String(prev["hash"]) : GENESIS_HASH;
    const hash = hashLedgerEvent({ seq, at, type, paymentId, data }, prevHash);

    this.db
      .prepare(
        `INSERT INTO ledger_events (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(seq, at, type, paymentId ?? null, encode(data), hash);
    return { seq, at, type, paymentId, data, hash };
  }

  history(paymentId?: string): LedgerEvent[] {
    const rows =
      paymentId === undefined
        ? this.db
            .prepare(`SELECT ${COLUMNS} FROM ledger_events ORDER BY seq`)
            .all()
        : this.db
            .prepare(
              `SELECT ${COLUMNS} FROM ledger_events WHERE payment_id = ? ` +
                `ORDER BY seq`,
            )
            .all(paymentId);
    return rows.map((row) => this.toEvent(row));
  }

  eventsByType(type: LedgerEventType, sinceIso?: string): LedgerEvent[] {
    // The idx_ledger_type index keeps this off a full table scan.
    const rows =
      sinceIso === undefined
        ? this.db
            .prepare(
              `SELECT ${COLUMNS} FROM ledger_events WHERE type = ? ` +
                `ORDER BY seq`,
            )
            .all(type)
        : this.db
            .prepare(
              `SELECT ${COLUMNS} FROM ledger_events WHERE type = ? ` +
                `AND at >= ? ORDER BY seq`,
            )
            .all(type, sinceIso);
    return rows.map((row) => this.toEvent(row));
  }

  verifyIntegrity(): LedgerIntegrity {
    return checkChain(this.history());
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
      hash: String(row["hash"]),
    };
  }
}
