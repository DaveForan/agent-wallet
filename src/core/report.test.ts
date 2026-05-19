import assert from "node:assert/strict";
import { test } from "node:test";
import type { CustodyProvider } from "../custody/custody.ts";
import type { PaymentRail } from "../rails/rail.ts";
import { money } from "./types.ts";
import { WalletDaemon } from "./wallet.ts";

const custody: CustodyProvider = {
  kind: "local",
  account: () => Promise.reject(new Error("unused")),
  authorize: () => Promise.reject(new Error("unused")),
};

const settlingRail: PaymentRail = {
  id: "x402",
  supports: () => true,
  quote: (req) =>
    Promise.resolve({
      total: req.amount,
      fee: { amount: 0n, currency: req.amount.currency },
      quoteRef: "q",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  settle: (req) =>
    Promise.resolve({
      settled: true,
      reference: "ref",
      settledAmount: req.amount,
    }),
};

function wallet(): WalletDaemon {
  return new WalletDaemon({
    policy: { mode: "autonomous" },
    rails: [settlingRail],
    custody,
  });
}

test("report.byAgent attributes settled payments to the requesting agent", async () => {
  const w = wallet();
  await w.pay({
    rail: "x402",
    channel: "deliberate",
    amount: money(100, "USD"),
    payee: { address: "p" },
    agentId: "agent-a",
  });
  await w.pay({
    rail: "x402",
    channel: "deliberate",
    amount: money(50, "USD"),
    payee: { address: "p" },
    agentId: "agent-a",
  });
  await w.pay({
    rail: "x402",
    channel: "deliberate",
    amount: money(200, "USD"),
    payee: { address: "p" },
    agentId: "agent-b",
  });
  const r = w.report();
  assert.equal(r.byAgent.length, 2);
  const a = r.byAgent.find((x) => x.agentId === "agent-a");
  const b = r.byAgent.find((x) => x.agentId === "agent-b");
  assert.ok(a);
  assert.ok(b);
  assert.equal(a.settled, 2);
  assert.equal(a.settledByCurrency["USD"], "150");
  assert.equal(b.settled, 1);
  assert.equal(b.settledByCurrency["USD"], "200");
});

test("report.byAgent counts denials when a mandate rejects an agent", async () => {
  const w = wallet();
  w.createMandate({
    id: "m",
    grantedBy: "op",
    cap: money(10_000, "USD"),
    agentId: "agent-a",
  });
  await w.pay({
    rail: "x402",
    channel: "deliberate",
    amount: money(100, "USD"),
    payee: { address: "p" },
    agentId: "agent-b",
    mandateId: "m",
  });
  const b = w.report().byAgent.find((x) => x.agentId === "agent-b");
  assert.ok(b);
  assert.equal(b.denied, 1);
  assert.equal(b.settled, 0);
});

test("an unauthenticated payment does not appear in byAgent", async () => {
  const w = wallet();
  await w.pay({
    rail: "x402",
    channel: "deliberate",
    amount: money(100, "USD"),
    payee: { address: "p" },
  });
  const r = w.report();
  assert.equal(r.byAgent.length, 0);
  assert.equal(r.payments.settled, 1);
});
