import assert from "node:assert/strict";
import { test } from "node:test";
import type { CustodyProvider } from "../custody/custody.ts";
import type { PaymentRail } from "../rails/rail.ts";
import { RateLimiter } from "./rate-limit.ts";
import { money } from "./types.ts";
import { WalletDaemon } from "./wallet.ts";

test("a rate limiter admits up to its count and then rejects", () => {
  const rl = new RateLimiter({ count: 2, windowMs: 1000 });
  const t = 1_000_000;
  assert.equal(rl.admit("a", t), true);
  assert.equal(rl.admit("a", t + 1), true);
  assert.equal(rl.admit("a", t + 2), false);
});

test("a rate limiter is per-key", () => {
  const rl = new RateLimiter({ count: 1, windowMs: 1000 });
  assert.equal(rl.admit("a"), true);
  assert.equal(rl.admit("b"), true);
  assert.equal(rl.admit("a"), false);
});

test("a rate limiter forgets calls outside its window", () => {
  const rl = new RateLimiter({ count: 1, windowMs: 100 });
  const t = 1_000_000;
  assert.equal(rl.admit("a", t), true);
  assert.equal(rl.admit("a", t + 50), false);
  assert.equal(rl.admit("a", t + 200), true);
});

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

test("the wallet rate-limits an agent across requests", async () => {
  const wallet = new WalletDaemon({
    policy: { mode: "autonomous" },
    rails: [settlingRail],
    custody,
    rateLimit: { count: 2, windowMs: 60_000 },
  });
  const call = () =>
    wallet.pay({
      rail: "x402",
      channel: "deliberate",
      amount: money(10, "USD"),
      payee: { address: "p" },
      agentId: "a",
    });
  assert.equal((await call()).status, "settled");
  assert.equal((await call()).status, "settled");
  const third = await call();
  assert.equal(third.status, "denied");
  assert.match((third as { reason: string }).reason, /rate limit/);
});

test("rate limits do not apply to unauthenticated payments", async () => {
  const wallet = new WalletDaemon({
    policy: { mode: "autonomous" },
    rails: [settlingRail],
    custody,
    rateLimit: { count: 1, windowMs: 60_000 },
  });
  const call = () =>
    wallet.pay({
      rail: "x402",
      channel: "deliberate",
      amount: money(10, "USD"),
      payee: { address: "p" },
    });
  assert.equal((await call()).status, "settled");
  // No agentId — the rate limiter has no key, so the second call also passes.
  assert.equal((await call()).status, "settled");
});
