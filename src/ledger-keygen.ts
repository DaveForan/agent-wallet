/**
 * Generate an Ed25519 key for signing the audit ledger.
 *
 *   npm run ledger:keygen [path]
 *
 * Writes the private key (PEM, mode 0600) to `path` — default
 * `.agent-wallet/ledger-key.pem` — then point the daemon at it with
 * `AGENT_WALLET_LEDGER_KEY=<path>`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Ed25519LedgerSigner } from "./core/ledger-signer.ts";

const path = process.argv[2] ?? ".agent-wallet/ledger-key.pem";
const { signer, privateKeyPem } = Ed25519LedgerSigner.generate();

mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, privateKeyPem, { mode: 0o600 });

console.log(`ledger signing key written to ${path}  (key id ${signer.keyId})`);
console.log(`enable it:  export AGENT_WALLET_LEDGER_KEY=${path}`);
console.log(
  "For real tamper-resistance, store this key off the wallet's host — a\n" +
    "secrets manager or a separate, access-controlled volume. An attacker\n" +
    "who can read it can rewrite the ledger undetectably.",
);
