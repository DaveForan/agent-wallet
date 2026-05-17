/**
 * The agent-wallet control daemon: `npm run control`.
 *
 * Starts the wallet with durable SQLite storage and two HTTP surfaces:
 *   - the operator control plane + web UI   http://localhost:4023/
 *   - the agent payment API                 http://localhost:4022/pay
 *
 * Both share one WalletDaemon and one SQLite file. A wallet is single-writer
 * by design, so it runs in exactly one process — this is that process.
 *
 * Env overrides: AGENT_WALLET_DB, AGENT_WALLET_CONTROL_PORT, AGENT_WALLET_PAY_PORT.
 */

import { money } from "./core/types.ts";
import { WalletDaemon } from "./core/wallet.ts";
import { LocalCustody } from "./custody/local-custody.ts";
import { StripeRail } from "./rails/stripe-rail.ts";
import { X402Rail } from "./rails/x402-rail.ts";
import { openWalletDatabase } from "./storage/db.ts";
import { SqliteApprovalStore } from "./storage/sqlite-approval-store.ts";
import { SqliteControlState } from "./storage/sqlite-control-state.ts";
import { SqliteLedger } from "./storage/sqlite-ledger.ts";
import { SqliteMandateStore } from "./storage/sqlite-mandate-store.ts";
import { startControlServer } from "./surfaces/control-api.ts";
import { startHttpServer } from "./surfaces/http-api.ts";

const db = openWalletDatabase(process.env["AGENT_WALLET_DB"]);

const wallet = new WalletDaemon({
  policy: {
    mode: "tiered",
    autoApproveThreshold: money(100, "USD"), // auto-approve at or under $1.00
    hardLimit: money(5000, "USD"), // never settle above $50.00
    requireMandate: true, // a payment with no mandate is escalated
  },
  rails: [new X402Rail({ network: "base-sepolia" }), new StripeRail()],
  custody: new LocalCustody(),
  ledger: new SqliteLedger(db),
  mandates: new SqliteMandateStore(db),
  approvals: new SqliteApprovalStore(db),
  control: new SqliteControlState(db),
});

const controlPort = Number(process.env["AGENT_WALLET_CONTROL_PORT"] ?? 4023);
const payPort = Number(process.env["AGENT_WALLET_PAY_PORT"] ?? 4022);

startControlServer(wallet, controlPort);
startHttpServer(wallet, payPort);

console.log("\nagent-wallet control daemon ready");
console.log(`  control plane + UI : http://localhost:${controlPort}/`);
console.log(`  agent payment API  : http://localhost:${payPort}/pay\n`);

process.on("SIGINT", () => {
  console.log("\nshutting down");
  db.close();
  process.exit(0);
});
