/**
 * Print the wallet's funding address: `npm run custody:address`.
 *
 * Default (local custody) generates or loads the local EVM keypair. With
 * `AGENT_WALLET_CUSTODY=managed` it resolves the Coinbase CDP server account
 * instead (needs the `CDP_*` env vars). Either way it prints the address to
 * fund with Base Sepolia testnet USDC.
 *
 * Set `AGENT_WALLET_KEYSTORE_PASSPHRASE` to encrypt the local keystore.
 */

import type { CustodyProvider } from "./custody/custody.ts";
import { LocalCustody } from "./custody/local-custody.ts";
import { ManagedCustody } from "./custody/managed-custody.ts";

const managed = process.env["AGENT_WALLET_CUSTODY"] === "managed";
const custody: CustodyProvider = managed
  ? new ManagedCustody()
  : new LocalCustody();
const source = managed ? "Coinbase CDP server account" : "local keystore";

const address = await custody.account("x402");

console.log(`
agent-wallet — funding address (${source})
──────────────────────────────────────────────────
  ${address}

Fund this address once to pay on the Base Sepolia testnet:

  1. No ETH is required — x402 payments are gasless (the facilitator
     sponsors gas). You only need testnet USDC.
  2. Get testnet USDC from a faucet, e.g.:
       https://faucet.circle.com         (select "Base Sepolia")
  3. Paste the address above as the recipient.

Verify the balance any time at:
  https://sepolia.basescan.org/address/${address}
`);
