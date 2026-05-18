import assert from "node:assert/strict";
import { test } from "node:test";
import { decode, encode } from "./codec.ts";

test("round-trips a plain JSON object unchanged", () => {
  const value = { a: 1, b: "x", c: true, d: null, e: [1, 2, 3] };
  assert.deepEqual(decode(encode(value)), value);
});

test("round-trips a bare bigint", () => {
  assert.equal(decode(encode(42n)), 42n);
  assert.equal(typeof decode(encode(42n)), "bigint");
});

test("round-trips bigints nested in an object", () => {
  const moneyValue = { amount: 10_000n, currency: "USDC" };
  const back = decode<typeof moneyValue>(encode(moneyValue));
  assert.equal(back.amount, 10_000n);
  assert.equal(typeof back.amount, "bigint");
  assert.equal(back.currency, "USDC");
});

test("round-trips bigints inside an array", () => {
  assert.deepEqual(decode<bigint[]>(encode([1n, 2n, 3n])), [1n, 2n, 3n]);
});

test("round-trips zero and very large bigints", () => {
  assert.equal(decode(encode(0n)), 0n);
  const big = 123456789012345678901234567890n;
  assert.equal(decode(encode(big)), big);
});

test("leaves a numeric string as a string", () => {
  const back = decode<{ x: string }>(encode({ x: "12345" }));
  assert.equal(back.x, "12345");
  assert.equal(typeof back.x, "string");
});

test("round-trips a full Mandate-shaped object losslessly", () => {
  const mandate = {
    id: "m",
    grantedBy: "operator",
    cap: { amount: 100_000n, currency: "USD" },
    perTxnCap: { amount: 5_000n, currency: "USD" },
    window: {
      cap: { amount: 50_000n, currency: "USD" },
      durationMs: 86_400_000,
    },
    rails: ["x402", "stripe"],
    revoked: false,
  };
  assert.deepEqual(decode(encode(mandate)), mandate);
});
