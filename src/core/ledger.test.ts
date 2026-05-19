import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkChain,
  GENESIS_HASH,
  hashLedgerEvent,
  InMemoryLedger,
  type LedgerEvent,
} from "./ledger.ts";

test("a freshly appended ledger verifies", () => {
  const ledger = new InMemoryLedger();
  ledger.append("payment.requested", { a: 1 });
  ledger.append("payment.settled", { b: 2n });
  ledger.append("wallet.frozen", { reason: "x" });
  const result = ledger.verifyIntegrity();
  assert.equal(result.ok, true);
  assert.equal(result.events, 3);
});

test("an empty ledger verifies", () => {
  assert.equal(new InMemoryLedger().verifyIntegrity().ok, true);
});

test("each event chains to the previous one's hash", () => {
  const ledger = new InMemoryLedger();
  const a = ledger.append("payment.requested", {});
  const b = ledger.append("payment.settled", {});
  assert.equal(a.hash, hashLedgerEvent(a, GENESIS_HASH));
  assert.equal(b.hash, hashLedgerEvent(b, a.hash));
});

test("checkChain detects a tampered event", () => {
  const ledger = new InMemoryLedger();
  ledger.append("payment.requested", { amount: 10 });
  ledger.append("payment.settled", { amount: 10 });
  // Alter an event's data without re-hashing it.
  const tampered: LedgerEvent[] = ledger
    .history()
    .map((e, i) => (i === 0 ? { ...e, data: { amount: 9999 } } : e));
  const result = checkChain(tampered);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 1);
});

test("checkChain detects a deleted event", () => {
  const ledger = new InMemoryLedger();
  ledger.append("payment.requested", {});
  ledger.append("payment.settled", {});
  ledger.append("wallet.frozen", {});
  const events = ledger.history();
  // Drop the middle event — the chain no longer links.
  const result = checkChain([events[0], events[2]]);
  assert.equal(result.ok, false);
});
