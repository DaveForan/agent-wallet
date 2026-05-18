import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AcpClient } from "../acp/acp-client.ts";
import { InMemoryFundingSourceStore } from "../core/funding.ts";
import { money, type Cart, type PaymentRequest } from "../core/types.ts";
import type { CustodyProvider } from "../custody/custody.ts";
import { AcpCheckoutRail } from "./acp-rail.ts";
import type { RailQuote } from "./rail.ts";

const custody: CustodyProvider = {
  kind: "local",
  account: () => Promise.reject(new Error("unused")),
  authorize: () => Promise.reject(new Error("unused")),
};

function rail(
  fundingStore: InMemoryFundingSourceStore = new InMemoryFundingSourceStore(),
): AcpCheckoutRail {
  return new AcpCheckoutRail({
    apiKey: "sk_test_x",
    fundingStore,
    acpClient: new AcpClient(),
  });
}

function cart(over: Partial<Cart["merchant"]> = {}): Cart {
  return {
    sessionId: "cs_1",
    merchant: {
      id: "m1",
      name: "Grocer",
      acpEndpoint: "https://shop.example.com/acp",
      networkBusinessProfile: "profile_1",
      ...over,
    },
    lineItems: [],
    total: money(2500, "USD"),
  };
}

function req(over: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    id: "r",
    rail: "acp",
    channel: "deliberate",
    amount: money(5000, "USD"),
    payee: { address: "Grocer" },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const noQuote: RailQuote = {
  total: money(0, "USD"),
  fee: money(0, "USD"),
  quoteRef: "",
  expiresAt: "",
};

function errorOf(raw: unknown): string {
  return String((raw as { error?: unknown })?.error ?? "");
}

test("quote() returns the verified cart total", async () => {
  const q = await rail().quote(req({ cart: cart() }));
  assert.equal(q.total.amount, 2500n);
  assert.equal(q.total.currency, "USD");
});

describe("settle() guards", () => {
  test("a payment with no cart is not settled", async () => {
    const result = await rail().settle(req(), noQuote, custody);
    assert.equal(result.settled, false);
    assert.match(errorOf(result.raw), /verified cart/);
  });

  test("a cart with no registered funding source is not settled", async () => {
    const result = await rail().settle(req({ cart: cart() }), noQuote, custody);
    assert.equal(result.settled, false);
    assert.match(errorOf(result.raw), /funding source/);
  });

  test("a cart whose merchant has no Stripe business profile is not settled", async () => {
    const store = new InMemoryFundingSourceStore();
    store.set({ paymentMethodId: "pm_1", addedAt: "2026-01-01T00:00:00.000Z" });
    const result = await rail(store).settle(
      req({ cart: cart({ networkBusinessProfile: undefined }) }),
      noQuote,
      custody,
    );
    assert.equal(result.settled, false);
    assert.match(errorOf(result.raw), /business profile/);
  });
});
