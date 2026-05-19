import assert from "node:assert/strict";
import { test } from "node:test";
import { Ed25519LedgerSigner } from "../core/ledger-signer.ts";
import { openWalletDatabase } from "./db.ts";
import { SqliteLedger } from "./sqlite-ledger.ts";

test("a SQLite ledger verifies after appends", () => {
  const ledger = new SqliteLedger(openWalletDatabase(":memory:"));
  ledger.append("payment.requested", { amount: 100n, currency: "USD" });
  ledger.append("payment.settled", {
    settlement: { settledAmount: { amount: 100n, currency: "USD" } },
  });
  ledger.append("wallet.frozen", { reason: "operator" });
  const result = ledger.verifyIntegrity();
  assert.equal(result.ok, true);
  assert.equal(result.events, 3);
});

test("a SQLite ledger round-trips bigint event data", () => {
  const ledger = new SqliteLedger(openWalletDatabase(":memory:"));
  const big = 123456789012345678901234567890n;
  ledger.append("payment.settled", { amount: big });
  assert.equal(ledger.history()[0].data["amount"], big);
});

test("a SQLite ledger detects a tampered row", () => {
  const db = openWalletDatabase(":memory:");
  const ledger = new SqliteLedger(db);
  ledger.append("payment.requested", { amount: 10n });
  ledger.append("payment.settled", { amount: 10n });
  // Edit the stored data directly, bypassing append() — as a tamper would.
  db.prepare("UPDATE ledger_events SET data = ? WHERE seq = 1").run(
    '{"amount":"TAMPERED"}',
  );
  const result = ledger.verifyIntegrity();
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 1);
});

test("a SQLite ledger detects a deleted row", () => {
  const db = openWalletDatabase(":memory:");
  const ledger = new SqliteLedger(db);
  ledger.append("payment.requested", {});
  ledger.append("payment.settled", {});
  ledger.append("wallet.frozen", {});
  // Drop the middle event — the hash chain no longer links.
  db.prepare("DELETE FROM ledger_events WHERE seq = 2").run();
  assert.equal(ledger.verifyIntegrity().ok, false);
});

test("a signed SQLite ledger verifies its events' signatures", () => {
  const { signer } = Ed25519LedgerSigner.generate();
  const ledger = new SqliteLedger(openWalletDatabase(":memory:"), signer);
  ledger.append("payment.requested", { amount: 10n });
  ledger.append("payment.settled", { amount: 10n });
  const result = ledger.verifyIntegrity();
  assert.equal(result.ok, true);
  assert.equal(ledger.history()[0].keyId, signer.keyId);
});

test("a signed SQLite ledger detects a tampered row", () => {
  const { signer } = Ed25519LedgerSigner.generate();
  const db = openWalletDatabase(":memory:");
  const ledger = new SqliteLedger(db, signer);
  ledger.append("payment.requested", { amount: 10n });
  db.prepare("UPDATE ledger_events SET data = ? WHERE seq = 1").run(
    '{"amount":"TAMPERED"}',
  );
  assert.equal(ledger.verifyIntegrity().ok, false);
});
