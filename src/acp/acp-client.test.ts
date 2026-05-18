import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Cart } from "../core/types.ts";
import { AcpClient, sessionToCart } from "./acp-client.ts";
import type { AcpCheckoutSession } from "./types.ts";

function session(over: Partial<AcpCheckoutSession> = {}): AcpCheckoutSession {
  return {
    id: "cs_1",
    status: "ready_for_payment",
    currency: "USD",
    line_items: [
      { id: "li1", name: "Milk", quantity: 2, unit_amount: 350 },
      { id: "li2", name: "Bread", quantity: 1, unit_amount: 500 },
    ],
    totals: [
      { type: "subtotal", amount: 1200 },
      { type: "tax", amount: 96 },
      { type: "total", amount: 1296 },
    ],
    ...over,
  };
}

/** A fetch that resolves to a fixed JSON body. */
function fetchReturning(body: unknown, status = 200): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )) as typeof fetch;
}

const merchant = {
  id: "m1",
  name: "Grocer",
  acpEndpoint: "https://shop.example.com/acp",
};

function cart(): Cart {
  return {
    sessionId: "cs_1",
    merchant,
    lineItems: [],
    total: { amount: 0n, currency: "USD" },
  };
}

describe("sessionToCart", () => {
  test("maps ACP line items and the total into a Cart", () => {
    const c = sessionToCart(session(), merchant, merchant.acpEndpoint);
    assert.equal(c.sessionId, "cs_1");
    assert.equal(c.lineItems.length, 2);
    assert.equal(c.lineItems[0].name, "Milk");
    assert.equal(c.lineItems[0].quantity, 2);
    assert.equal(c.lineItems[0].unitPrice.amount, 350n);
    assert.equal(c.total.amount, 1296n);
    assert.equal(c.total.currency, "USD");
  });

  test("throws when the session has no total", () => {
    assert.throws(() =>
      sessionToCart(
        session({ totals: [{ type: "subtotal", amount: 10 }] }),
        merchant,
        merchant.acpEndpoint,
      ),
    );
  });
});

describe("AcpClient.verify", () => {
  test("returns the merchant's authoritative cart", async () => {
    const client = new AcpClient({ fetchImpl: fetchReturning(session()) });
    const verified = await client.verify(cart());
    assert.equal(verified.total.amount, 1296n);
    assert.equal(verified.lineItems.length, 2);
    assert.equal(verified.merchant.acpEndpoint, merchant.acpEndpoint);
  });

  test("rejects a session that is not ready for payment", async () => {
    const client = new AcpClient({
      fetchImpl: fetchReturning(session({ status: "incomplete" })),
    });
    await assert.rejects(client.verify(cart()), /not ready/);
  });

  test("rejects a non-https merchant endpoint", async () => {
    const client = new AcpClient({ fetchImpl: fetchReturning(session()) });
    await assert.rejects(
      client.verify({
        ...cart(),
        merchant: { ...merchant, acpEndpoint: "http://insecure.example.com" },
      }),
      /https/,
    );
  });

  test("rejects a cart with no merchant endpoint", async () => {
    const client = new AcpClient({ fetchImpl: fetchReturning(session()) });
    await assert.rejects(
      client.verify({ ...cart(), merchant: { id: "m1" } }),
      /endpoint/,
    );
  });
});

describe("AcpClient.completePurchase", () => {
  test("completes a checkout and returns the order", async () => {
    const client = new AcpClient({
      fetchImpl: fetchReturning({
        id: "cs_1",
        status: "completed",
        order: { id: "ord_1" },
      }),
    });
    const result = await client.completePurchase(
      "https://shop.example.com/acp",
      "cs_1",
      "spt_123",
    );
    assert.equal(result.order?.id, "ord_1");
  });

  test("throws when the merchant rejects the completion", async () => {
    const client = new AcpClient({
      fetchImpl: fetchReturning({ error: "declined" }, 402),
    });
    await assert.rejects(
      client.completePurchase("https://shop.example.com/acp", "cs_1", "spt_x"),
      /HTTP 402/,
    );
  });
});
