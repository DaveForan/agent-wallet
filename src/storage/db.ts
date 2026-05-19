import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Default database location. `.agent-wallet/` is gitignored. */
export const DEFAULT_DB_PATH = ".agent-wallet/wallet.db";

/**
 * Schema for the wallet's durable state. One process owns this file — a wallet
 * is a single-writer store by design, so the spend-cap accounting can never be
 * raced by a second writer.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS ledger_events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  type       TEXT NOT NULL,
  payment_id TEXT,
  data       TEXT NOT NULL,
  hash       TEXT NOT NULL DEFAULT '',
  signature  TEXT,
  key_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_payment ON ledger_events(payment_id);
CREATE INDEX IF NOT EXISTS idx_ledger_type    ON ledger_events(type);

CREATE TABLE IF NOT EXISTS mandates (
  id   TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_approvals (
  approval_id TEXT PRIMARY KEY,
  payment_id  TEXT NOT NULL,
  reason      TEXT NOT NULL,
  data        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_control (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  frozen        INTEGER NOT NULL DEFAULT 0,
  freeze_reason TEXT,
  changed_at    TEXT
);

CREATE TABLE IF NOT EXISTS funding_source (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT
);
`;

/**
 * Open (creating if needed) the wallet database, apply the schema, and return
 * the connection. Pass `:memory:` for an ephemeral database in tests.
 */
export function openWalletDatabase(path: string = DEFAULT_DB_PATH): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  // WAL lets readers (status, reports) run while a payment is being written.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  // Migrate databases that predate the ledger hash chain / event signing.
  for (const column of [
    "hash TEXT NOT NULL DEFAULT ''",
    "signature TEXT",
    "key_id TEXT",
  ]) {
    try {
      db.exec(`ALTER TABLE ledger_events ADD COLUMN ${column}`);
    } catch {
      // The column already exists — nothing to migrate.
    }
  }
  // The control and funding tables each hold exactly one row; ensure they exist.
  db.prepare(
    "INSERT OR IGNORE INTO wallet_control (id, frozen) VALUES (1, 0)",
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO funding_source (id, data) VALUES (1, NULL)",
  ).run();
  return db;
}
