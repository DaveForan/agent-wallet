import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { money } from "../core/types.ts";
import { WalletDaemon } from "../core/wallet.ts";
import type { CustodyProvider } from "../custody/custody.ts";
import type { PaymentRail } from "../rails/rail.ts";
import { createPayingFetch, parseX402Challenge } from "./x402-interceptor.ts";

function challengeResponse(amount: number): Response {
  return new Response(null, {
    status: 402,
    headers: {
      "x-payment-required": JSON.stringify({
        payTo: "0xabc",
        amount,
        currency: "USDC",
      }),
    },
  });
}

describe("parseX402Challenge", () => {
  test("reads a valid challenge header", () => {
    const challenge = parseX402Challenge(challengeResponse(10));
    assert.ok(challenge);
    assert.equal(challenge.payTo, "0xabc");
    assert.equal(challenge.amount.amount, 10n);
    assert.equal(challenge.amount.currency, "USDC");
  });

  test("returns undefined when the header is absent", () => {
    assert.equal(
      parseX402Challenge(new Response(null, { status: 402 })),
      undefined,
    );
  });

  test("returns undefined on a malformed header", () => {
    const res = new Response(null, {
      status: 402,
      headers: { "x-payment-required": "not json" },
    });
    assert.equal(parseX402Challenge(res), undefined);
  });

  test("returns undefined when required fields are missing", () => {
    const res = new Response(null, {
      status: 402,
      headers: { "x-payment-required": JSON.stringify({ payTo: "0xabc" }) },
    });
    assert.equal(parseX402Challenge(res), undefined);
  });
});

const custody: CustodyProvider = {
  kind: "local",
  account: () => Promise.reject(new Error("unused")),
  authorize: () => Promise.reject(new Error("unused")),
};

/** A rail that always settles, returning a fixed proof reference. */
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
      reference: "settle-proof",
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

describe("createPayingFetch", () => {
  test("passes a non-402 response straight through", async () => {
    const baseFetch = () => Promise.resolve(new Response("ok", { status: 200 }));
    const res = await createPayingFetch(wallet(), { baseFetch })("http://x");
    assert.equal(res.status, 200);
  });

  test("pays a 402 challenge and retries with the settlement proof", async () => {
    let calls = 0;
    const xPaymentSeen: (string | null)[] = [];
    const baseFetch = (_input: string | URL, init?: RequestInit) => {
      calls++;
      xPaymentSeen.push(new Headers(init?.headers).get("x-payment"));
      return Promise.resolve(
        calls === 1
          ? challengeResponse(10)
          : new Response("paid content", { status: 200 }),
      );
    };
    const res = await createPayingFetch(wallet(), { baseFetch })("http://x");
    assert.equal(res.status, 200);
    assert.equal(calls, 2, "the request is retried after payment");
    assert.equal(
      xPaymentSeen[1],
      "settle-proof",
      "the retry carries the settlement proof header",
    );
  });

  test("does not pay a challenge above maxPerCall", async () => {
    let calls = 0;
    const baseFetch = () => {
      calls++;
      return Promise.resolve(challengeResponse(999));
    };
    const res = await createPayingFetch(wallet(), {
      baseFetch,
      maxPerCall: money(10, "USDC"),
    })("http://x");
    assert.equal(res.status, 402, "an over-limit challenge is left unpaid");
    assert.equal(calls, 1, "and the request is not retried");
  });
});
