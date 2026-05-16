/**
 * Generate (or load) the wallet's local EVM keypair: `npm run custody:address`.
 *
 * Run this once to create the keystore and print the address you must fund
 * with Base Sepolia testnet USDC before any x402 payment can settle.
 *
 * Set AGENT_WALLET_KEYSTORE_PASSPHRASE first if you want the keystore
 * encrypted. Without it the key is stored in plaintext (testnet keys only).
 */

import { LocalCustody } from "./custody/local-custody.ts";

const custody = new LocalCustody();
const address = await custody.account("x402");

console.log(`
agent-wallet — local custody address
─────────────────────────────────────
  ${address}

This account exists the moment its key is generated; nothing was registered
anywhere. To let it pay on the Base Sepolia testnet, fund it once:

  1. Base Sepolia ETH is NOT required — x402 payments are gasless (the
     facilitator sponsors gas). You only need testnet USDC.
  2. Get testnet USDC from a faucet, e.g.:
       https://faucet.circle.com         (select "Base Sepolia")
  3. Paste the address above as the recipient.

Verify the balance any time at:
  https://sepolia.basescan.org/address/${address}
`);
