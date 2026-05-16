/**
 * Runnable demo: `npm run demo`.
 *
 * Shows the policy engine — the wallet's trust boundary — making
 * allow / deny / needs_approval decisions across all three autonomy modes.
 *
 * No real rail is contacted: settlement against x402 and Stripe is the next
 * milestone, so the rails are stubbed on purpose. A payment that policy
 * *allows* therefore reaches a stubbed rail and reports `failed` — that
 * boundary is exactly where the next work begins.
 */

import { ManagedCustody } from "./custody/managed-custody.ts";
import { money, type Mandate } from "./core/types.ts";
import { WalletDaemon } from "./core/wallet.ts";
import { StripeRail } from "./rails/stripe-rail.ts";
import { X402Rail } from "./rails/x402-rail.ts";

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function describe(result: Awaited<ReturnType<WalletDaemon["pay"]>>): string {
  switch (result.status) {
    case "settled":
      return `settled (${result.settlement.reference})`;
    case "denied":
      return `DENIED — ${result.reason}`;
    case "failed":
      return `reached rail, failed — ${result.reason}`;
    case "pending_approval":
      return `NEEDS APPROVAL — ${result.reason}`;
  }
}

/** A $50 lifetime mandate, $5 per payment, usable on either rail. */
const mandate: Mandate = {
  id: "mandate-research-apis",
  grantedBy: "dave",
  cap: money(5000, "USD"),
  perTxnCap: money(500, "USD"),
  rails: ["x402", "stripe"],
};

function newWallet(...args: ConstructorParameters<typeof WalletDaemon>) {
  return new WalletDaemon(...args);
}

async function run(): Promise<void> {
  section("tiered mode — auto-approve at or under $1.00, hard limit $20.00");
  const tiered = newWallet({
    policy: {
      mode: "tiered",
      autoApproveThreshold: money(100, "USD"),
      hardLimit: money(2000, "USD"),
    },
    rails: [new X402Rail(), new StripeRail()],
    custody: new ManagedCustody(),
  });
  tiered.createMandate(mandate);
  for (const cents of [25, 350, 5000]) {
    const result = await tiered.pay({
      rail: "x402",
      amount: money(cents, "USD"),
      payee: { address: "https://api.example.com", label: "Example API" },
      memo: "fetch a dataset",
      mandateId: mandate.id,
    });
    console.log(`  $${(cents / 100).toFixed(2).padStart(7)}  ->  ${describe(result)}`);
  }

  section("approve-every mode — nothing settles without a human");
  const strict = newWallet({
    policy: { mode: "approve-every" },
    rails: [new X402Rail(), new StripeRail()],
    custody: new ManagedCustody(),
  });
  const pending = await strict.pay({
    rail: "stripe",
    amount: money(99, "USD"),
    payee: { address: "merchant_acme", label: "Acme Corp" },
  });
  console.log(`  $   0.99  ->  ${describe(pending)}`);
  if (pending.status === "pending_approval") {
    const resolved = await strict.resolveApproval(pending.approvalId, true);
    console.log(`  human approves  ->  ${describe(resolved)}`);
  }

  section("autonomous mode — the mandate is the only gate");
  const auto = newWallet({
    policy: { mode: "autonomous" },
    rails: [new X402Rail(), new StripeRail()],
    custody: new ManagedCustody(),
  });
  auto.createMandate(mandate);
  const overCap = await auto.pay({
    rail: "x402",
    amount: money(750, "USD"), // over the $5.00 per-transaction cap
    payee: { address: "https://api.example.com" },
    mandateId: mandate.id,
  });
  console.log(`  $   7.50  ->  ${describe(overCap)}`);

  console.log("\n(policy engine works end-to-end; rails are stubbed — see README)\n");
}

run().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
