import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
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

test("an escalated approval expires once its window passes", async () => {
  const wallet = new WalletDaemon({
    policy: { mode: "approve-every" },
    rails: [settlingRail],
    custody,
    approvalTimeoutMs: 30,
  });
  const result = await wallet.pay({
    rail: "x402",
    channel: "deliberate",
    amount: money(10, "USD"),
    payee: { address: "p" },
  });
  assert.equal(result.status, "pending_approval");
  assert.equal(wallet.listPendingApprovals().length, 1);

  await sleep(60);

  assert.equal(wallet.listPendingApprovals().length, 0);
  const audit = wallet.audit().map((e) => e.type);
  assert.ok(audit.includes("approval.expired"));
  assert.ok(
    audit.filter((t) => t === "payment.blocked").length >= 1,
    "an expired approval blocks its payment",
  );
});

test("a pending approval without a timeout is not expired", async () => {
  const wallet = new WalletDaemon({
    policy: { mode: "approve-every" },
    rails: [settlingRail],
    custody,
  });
  await wallet.pay({
    rail: "x402",
    channel: "deliberate",
    amount: money(10, "USD"),
    payee: { address: "p" },
  });
  await sleep(40);
  assert.equal(wallet.listPendingApprovals().length, 1);
});
