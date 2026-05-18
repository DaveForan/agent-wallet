import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PolicyEngine, type PolicyContext } from "./policy.ts";
import {
  money,
  type Mandate,
  type PaymentRequest,
  type PolicyConfig,
} from "./types.ts";

function req(over: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    id: "r",
    rail: "x402",
    channel: "deliberate",
    amount: money(100, "USD"),
    payee: { address: "payee-1" },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function mandate(over: Partial<Mandate> = {}): Mandate {
  return { id: "m", grantedBy: "operator", cap: money(10_000, "USD"), ...over };
}

/** Run the policy engine and return just the outcome. */
function decide(
  config: PolicyConfig,
  request: PaymentRequest,
  ctx: PolicyContext = {},
): string {
  return new PolicyEngine(config).evaluate(request, ctx).outcome;
}

describe("autonomy modes", () => {
  test("autonomous allows a permitted payment", () => {
    assert.equal(decide({ mode: "autonomous" }, req()), "allow");
  });

  test("approve-every escalates everything", () => {
    assert.equal(decide({ mode: "approve-every" }, req()), "needs_approval");
  });

  test("tiered allows at or under the threshold", () => {
    const config: PolicyConfig = {
      mode: "tiered",
      autoApproveThreshold: money(100, "USD"),
    };
    assert.equal(decide(config, req({ amount: money(100, "USD") })), "allow");
    assert.equal(decide(config, req({ amount: money(40, "USD") })), "allow");
  });

  test("tiered escalates above the threshold", () => {
    const config: PolicyConfig = {
      mode: "tiered",
      autoApproveThreshold: money(100, "USD"),
    };
    assert.equal(
      decide(config, req({ amount: money(101, "USD") })),
      "needs_approval",
    );
  });

  test("tiered with no threshold escalates", () => {
    assert.equal(decide({ mode: "tiered" }, req()), "needs_approval");
  });

  test("tiered escalates when the threshold currency differs", () => {
    const config: PolicyConfig = {
      mode: "tiered",
      autoApproveThreshold: money(100, "USD"),
    };
    assert.equal(
      decide(config, req({ amount: money(10, "USDC") })),
      "needs_approval",
    );
  });
});

describe("hard limit", () => {
  test("denies an amount above the hard limit", () => {
    const config: PolicyConfig = {
      mode: "autonomous",
      hardLimit: money(2000, "USD"),
    };
    assert.equal(decide(config, req({ amount: money(2001, "USD") })), "deny");
  });

  test("allows an amount at or under the hard limit", () => {
    const config: PolicyConfig = {
      mode: "autonomous",
      hardLimit: money(2000, "USD"),
    };
    assert.equal(decide(config, req({ amount: money(2000, "USD") })), "allow");
  });

  test("escalates when the hard-limit currency differs", () => {
    const config: PolicyConfig = {
      mode: "autonomous",
      hardLimit: money(2000, "USD"),
    };
    assert.equal(
      decide(config, req({ amount: money(10, "USDC") })),
      "needs_approval",
    );
  });
});

describe("requireMandate", () => {
  test("escalates a payment with no mandate when requireMandate is set", () => {
    assert.equal(
      decide({ mode: "autonomous", requireMandate: true }, req()),
      "needs_approval",
    );
  });

  test("allows a mandate-backed payment when requireMandate is set", () => {
    assert.equal(
      decide({ mode: "autonomous", requireMandate: true }, req(), {
        mandate: mandate(),
      }),
      "allow",
    );
  });

  test("allows a payment with no mandate when requireMandate is unset", () => {
    assert.equal(decide({ mode: "autonomous" }, req()), "allow");
  });
});

describe("mandate constraints", () => {
  const autonomous: PolicyConfig = { mode: "autonomous" };

  test("denies a revoked mandate", () => {
    assert.equal(
      decide(autonomous, req(), { mandate: mandate({ revoked: true }) }),
      "deny",
    );
  });

  test("denies an expired mandate", () => {
    assert.equal(
      decide(autonomous, req(), {
        mandate: mandate({ expiresAt: "2020-01-01T00:00:00.000Z" }),
      }),
      "deny",
    );
  });

  test("allows a mandate that has not yet expired", () => {
    assert.equal(
      decide(autonomous, req(), {
        mandate: mandate({ expiresAt: "2099-01-01T00:00:00.000Z" }),
      }),
      "allow",
    );
  });

  test("denies a rail not on the mandate", () => {
    assert.equal(
      decide(autonomous, req({ rail: "stripe" }), {
        mandate: mandate({ rails: ["x402"] }),
      }),
      "deny",
    );
  });

  test("allows a rail the mandate permits", () => {
    assert.equal(
      decide(autonomous, req({ rail: "x402" }), {
        mandate: mandate({ rails: ["x402"] }),
      }),
      "allow",
    );
  });

  test("denies a payee not on the allowlist", () => {
    assert.equal(
      decide(autonomous, req({ payee: { address: "stranger" } }), {
        mandate: mandate({ allowedPayees: ["payee-1"] }),
      }),
      "deny",
    );
  });

  test("allows an allowlisted payee", () => {
    assert.equal(
      decide(autonomous, req({ payee: { address: "payee-1" } }), {
        mandate: mandate({ allowedPayees: ["payee-1"] }),
      }),
      "allow",
    );
  });

  test("denies a payee category not permitted", () => {
    assert.equal(
      decide(autonomous, req({ payee: { address: "p", category: "gambling" } }), {
        mandate: mandate({ allowedCategories: ["software"] }),
      }),
      "deny",
    );
  });

  test("allows a permitted payee category", () => {
    assert.equal(
      decide(autonomous, req({ payee: { address: "p", category: "software" } }), {
        mandate: mandate({ allowedCategories: ["software"] }),
      }),
      "allow",
    );
  });

  test("denies an amount over the per-transaction cap", () => {
    assert.equal(
      decide(autonomous, req({ amount: money(600, "USD") }), {
        mandate: mandate({ perTxnCap: money(500, "USD") }),
      }),
      "deny",
    );
  });

  test("allows an amount within the per-transaction cap", () => {
    assert.equal(
      decide(autonomous, req({ amount: money(500, "USD") }), {
        mandate: mandate({ perTxnCap: money(500, "USD") }),
      }),
      "allow",
    );
  });

  test("denies when the lifetime cap would be exceeded", () => {
    assert.equal(
      decide(autonomous, req({ amount: money(100, "USD") }), {
        mandate: mandate({ cap: money(1000, "USD") }),
        spentAgainstMandate: money(950, "USD"),
      }),
      "deny",
    );
  });

  test("allows when spend stays within the lifetime cap", () => {
    assert.equal(
      decide(autonomous, req({ amount: money(50, "USD") }), {
        mandate: mandate({ cap: money(1000, "USD") }),
        spentAgainstMandate: money(950, "USD"),
      }),
      "allow",
    );
  });

  test("denies when the rolling-window cap would be exceeded", () => {
    assert.equal(
      decide(autonomous, req({ amount: money(100, "USD") }), {
        mandate: mandate({
          window: { cap: money(500, "USD"), durationMs: 86_400_000 },
        }),
        spentInWindow: money(450, "USD"),
      }),
      "deny",
    );
  });

  test("allows when spend stays within the rolling-window cap", () => {
    assert.equal(
      decide(autonomous, req({ amount: money(40, "USD") }), {
        mandate: mandate({
          window: { cap: money(500, "USD"), durationMs: 86_400_000 },
        }),
        spentInWindow: money(450, "USD"),
      }),
      "allow",
    );
  });
});

test("every decision carries a non-empty reason", () => {
  const engine = new PolicyEngine({ mode: "approve-every" });
  const decision = engine.evaluate(req(), {});
  assert.ok(decision.reason.length > 0);
});
