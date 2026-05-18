import assert from "node:assert/strict";
import { test } from "node:test";
import type { CustodyProvider } from "../custody/custody.ts";
import type { PaymentRail } from "../rails/rail.ts";
import { money, type Mandate } from "./types.ts";
import { WalletDaemon } from "./wallet.ts";

/** Custody is not exercised — the test rail settles without signing. */
const custody: CustodyProvider = {
  kind: "local",
  account: () => Promise.reject(new Error("unused")),
  authorize: () => Promise.reject(new Error("unused")),
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A rail that always settles, after a short delay. The delay forces `pay()`
 * calls to interleave at their `await` points — which is exactly where the
 * check-then-settle race lives.
 */
function slowRail(): PaymentRail {
  return {
    id: "x402",
    supports: () => true,
    quote: async (req) => {
      await delay(5);
      return {
        total: req.amount,
        fee: { amount: 0n, currency: req.amount.currency },
        quoteRef: "test",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    },
    settle: async (req) => {
      await delay(5);
      return { settled: true, reference: "tx", settledAmount: req.amount };
    },
  };
}

const mandate: Mandate = {
  id: "m",
  grantedBy: "test",
  cap: money(100, "USD"),
  rails: ["x402"],
};

function newWallet(): WalletDaemon {
  const wallet = new WalletDaemon({
    policy: { mode: "autonomous" },
    rails: [slowRail()],
    custody,
  });
  wallet.createMandate(mandate);
  return wallet;
}

test("two concurrent payments cannot overspend a mandate cap", async () => {
  const wallet = newWallet();

  // Two payments of 60 against a cap of 100 — at most one may settle.
  const results = await Promise.all([
    wallet.pay({
      rail: "x402",
      amount: money(60, "USD"),
      payee: { address: "p" },
      mandateId: "m",
    }),
    wallet.pay({
      rail: "x402",
      amount: money(60, "USD"),
      payee: { address: "p" },
      mandateId: "m",
    }),
  ]);

  const settled = results.filter((r) => r.status === "settled").length;
  assert.equal(settled, 1, "exactly one of the two payments may settle");
  assert.ok(
    results.some((r) => r.status === "denied"),
    "the other payment must be denied",
  );

  const spent = wallet.report().mandates.find((m) => m.id === "m")?.spent;
  assert.equal(spent, "60", "settled spend must never exceed the cap");
});

test("many concurrent payments cannot overspend a mandate cap", async () => {
  const wallet = newWallet();

  // Ten payments of 30 against a cap of 100 — at most three may settle.
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      wallet.pay({
        rail: "x402",
        amount: money(30, "USD"),
        payee: { address: "p" },
        mandateId: "m",
      }),
    ),
  );

  const settled = results.filter((r) => r.status === "settled").length;
  assert.equal(settled, 3, "only three payments of 30 fit under the cap of 100");

  const spent = wallet.report().mandates.find((m) => m.id === "m")?.spent;
  assert.equal(spent, "90", "settled spend must never exceed the cap");
});

test("an approval is re-checked against the cap before it settles", async () => {
  // Tiered: payments over 50 escalate, payments at/under 50 settle straight away.
  const wallet = new WalletDaemon({
    policy: { mode: "tiered", autoApproveThreshold: money(50, "USD") },
    rails: [slowRail()],
    custody,
  });
  wallet.createMandate(mandate); // cap 100

  // A 70 payment escalates for approval.
  const escalated = await wallet.pay({
    rail: "x402",
    amount: money(70, "USD"),
    payee: { address: "p" },
    mandateId: "m",
  });
  assert.equal(escalated.status, "pending_approval");

  // Meanwhile a 40 payment auto-settles, leaving only 60 of the cap.
  const auto = await wallet.pay({
    rail: "x402",
    amount: money(40, "USD"),
    payee: { address: "p" },
    mandateId: "m",
  });
  assert.equal(auto.status, "settled");

  // Approving the 70 payment now would breach the cap — it must be denied.
  const approvalId =
    escalated.status === "pending_approval" ? escalated.approvalId : "";
  const resolved = await wallet.resolveApproval(approvalId, true);
  assert.equal(
    resolved.status,
    "denied",
    "an approved payment that no longer fits the cap must be denied",
  );

  const spent = wallet.report().mandates.find((m) => m.id === "m")?.spent;
  assert.equal(spent, "40", "only the 40 payment settled");
});
