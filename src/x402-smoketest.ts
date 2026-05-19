/**
 * End-to-end x402 payment smoke test on Base Sepolia: `npm run x402:check`.
 *
 * Spawns the local x402 resource server, then has the wallet pay `GET /paid`
 * through the full stack: policy -> X402Rail.quote() -> X402Rail.settle().
 *
 * Funding: settlement moves real Base Sepolia USDC, so the wallet's custody
 * address must hold testnet USDC (see `npm run custody:address`). Without a
 * balance the test still proves quote() and the signing pipeline — only the
 * final on-chain settlement needs funds.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { bigintReplacer, money } from "./core/types.ts";
import type { CustodyProvider } from "./custody/custody.ts";
import { LocalCustody } from "./custody/local-custody.ts";
import { ManagedCustody } from "./custody/managed-custody.ts";
import { WalletDaemon } from "./core/wallet.ts";
import { X402Rail } from "./rails/x402-rail.ts";

/**
 * Custody backend, selected by AGENT_WALLET_CUSTODY: "managed" uses Coinbase
 * CDP (needs the CDP_* env vars), anything else uses the local keystore. This
 * is how the CDP path is verified — the same test, a different signer.
 */
const custody: CustodyProvider =
  process.env["AGENT_WALLET_CUSTODY"] === "managed"
    ? new ManagedCustody()
    : new LocalCustody();

const PORT = 4021;
const RESOURCE_URL = `http://localhost:${PORT}/paid`;

/** Poll the resource until it answers 402 — i.e. the payment middleware is up. */
async function waitForResource(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(RESOURCE_URL);
      if (res.status === 402) return;
    } catch {
      // server not listening yet
    }
    await sleep(250);
  }
  throw new Error(`x402 resource never returned 402 at ${RESOURCE_URL}`);
}

async function main(): Promise<void> {
  const serverScript = new URL("./x402-test-resource.ts", import.meta.url)
    .pathname;
  const server = spawn(process.execPath, [serverScript], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, X402_TEST_PORT: String(PORT) },
  });

  try {
    await waitForResource();

    const wallet = new WalletDaemon({
      policy: { mode: "autonomous" },
      // allowPrivate: the test resource server runs on localhost.
      rails: [new X402Rail({ network: "base-sepolia", allowPrivate: true })],
      custody,
    });

    console.log(`custody: ${custody.kind}`);
    console.log(`\npaying ${RESOURCE_URL}  (authorized ceiling: $1.00)\n`);
    const result = await wallet.pay({
      rail: "x402",
      // USDC has 6 decimals; 1_000_000 atomic units = $1.00 ceiling.
      amount: money(1_000_000, "USDC"),
      payee: { address: RESOURCE_URL, label: "x402 test resource" },
      memo: "x402 rail smoke test",
    });

    console.log(`pay() -> ${JSON.stringify(result, bigintReplacer, 2)}`);

    if (result.status === "settled") {
      const tx = result.settlement.reference;
      console.log("\nSETTLED on Base Sepolia.");
      console.log(`  tx hash:  ${tx}`);
      console.log(`  basescan: https://sepolia.basescan.org/tx/${tx}`);
    } else {
      console.log(`\nNot settled (status: "${result.status}").`);
      console.log(
        "If the reason mentions an insufficient balance, the rail and " +
          "signing pipeline are working — fund the custody address with " +
          "Base Sepolia USDC (npm run custody:address) and re-run.",
      );
    }
  } finally {
    server.kill();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
