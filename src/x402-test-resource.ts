/**
 * A minimal x402-protected HTTP resource — test infrastructure for the x402
 * rail. `npm run x402:resource` starts it; the smoke test pays `GET /paid`.
 *
 * `GET /paid` is guarded by the x402 payment middleware: an unpaid request is
 * answered with `402 Payment Required`; a request carrying a valid payment is
 * verified and settled on Base Sepolia by the public x402 facilitator, then
 * served the protected JSON.
 */

import { HTTPFacilitatorClient } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddlewareFromConfig } from "@x402/express";
import express from "express";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const PORT = Number(process.env["X402_TEST_PORT"] ?? 4021);
/** Base Sepolia, in CAIP-2 form. */
const NETWORK = "eip155:84532";
const PRICE = "$0.01";

/**
 * The merchant that receives the payment. A throwaway address is fine here —
 * it only ever receives test USDC and its key is never used, so it needs no
 * funding. Override with X402_TEST_PAYTO to send funds somewhere specific.
 */
const payTo =
  process.env["X402_TEST_PAYTO"] ??
  privateKeyToAccount(generatePrivateKey()).address;

const app = express();

app.use(
  paymentMiddlewareFromConfig(
    {
      "/paid": {
        accepts: {
          scheme: "exact",
          network: NETWORK,
          payTo,
          price: PRICE,
          maxTimeoutSeconds: 120,
        },
        description: "agent-wallet x402 rail test resource",
      },
    },
    new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" }),
    [{ network: NETWORK, server: new ExactEvmScheme() }],
  ),
);

app.get("/paid", (_req, res) => {
  res.json({
    ok: true,
    content: "paid x402 content unlocked",
    servedAt: new Date().toISOString(),
  });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`x402 test resource listening on http://localhost:${PORT}/paid`);
  console.log(`  network: ${NETWORK} (Base Sepolia)`);
  console.log(`  price:   ${PRICE}`);
  console.log(`  payTo:   ${payTo}`);
});
