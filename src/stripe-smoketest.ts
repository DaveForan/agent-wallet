/**
 * Smoke test for the Stripe rail: `npm run stripe:check`.
 *
 * Issues a real test-mode virtual card through StripeRail. Needs
 * `STRIPE_SECRET_KEY` set to a **test-mode** key (`sk_test_...`) with Stripe
 * Issuing enabled. Without a key the test reports what to set and exits
 * without failing; a non-test key is refused outright — this test issues a
 * card, and must never run against a live account.
 */

import { bigintReplacer, money } from "./core/types.ts";
import { WalletDaemon } from "./core/wallet.ts";
import type { CustodyProvider } from "./custody/custody.ts";
import { StripeRail } from "./rails/stripe-rail.ts";

const key = process.env["STRIPE_SECRET_KEY"];
if (!key) {
  console.log(
    "skipped — set STRIPE_SECRET_KEY to a test-mode key (sk_test_...) with\n" +
      "Stripe Issuing enabled, then re-run. See the README.",
  );
  process.exit(0);
}
if (!key.startsWith("sk_test_")) {
  console.error(
    "refusing to run: STRIPE_SECRET_KEY is not a test-mode key (sk_test_...).\n" +
      "This test issues a card — never point it at a live key.",
  );
  process.exit(1);
}

// The Stripe rail does not use the custody layer.
const custody: CustodyProvider = {
  kind: "managed",
  account: () => Promise.reject(new Error("custody unused for the Stripe rail")),
  authorize: () =>
    Promise.reject(new Error("custody unused for the Stripe rail")),
};

const wallet = new WalletDaemon({
  policy: { mode: "autonomous" },
  rails: [new StripeRail()],
  custody,
});

console.log("issuing a single-use virtual card via Stripe Issuing (test mode)\n");
const result = await wallet.pay({
  rail: "stripe",
  amount: money(2500, "USD"), // $25.00 spend cap locked onto the card
  payee: { address: "merchant_demo", label: "Demo merchant" },
  memo: "stripe rail smoke test",
});

console.log(`pay() -> ${JSON.stringify(result, bigintReplacer, 2)}`);

if (result.status === "settled") {
  const card = result.settlement.reference;
  console.log("\nSETTLED — issued a single-use virtual card.");
  console.log(`  card id  : ${card}`);
  console.log(
    `  dashboard: https://dashboard.stripe.com/test/issuing/cards/${card}`,
  );
} else {
  console.log(`\nNot settled (status: "${result.status}").`);
  console.log(`  reason: ${result.reason}`);
  console.log(
    "If the reason mentions Issuing, enable Issuing on the test account.",
  );
  process.exitCode = 1;
}
