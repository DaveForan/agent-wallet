/**
 * The agent-wallet daemon: `npm run daemon`.
 *
 * One process, one WalletDaemon, one SQLite file — serving every surface, so
 * the agent and the operator drive the *same* wallet:
 *   - MCP server (Streamable HTTP)   http://localhost:4024/mcp
 *   - agent payment API              http://localhost:4022/pay
 *   - operator control plane + UI    http://localhost:4023/
 *
 * A wallet is single-writer by design (the spend-cap accounting must never be
 * raced), so it runs in exactly one process — this is that process.
 *
 * Env overrides: AGENT_WALLET_DB, AGENT_WALLET_MCP_PORT, AGENT_WALLET_PAY_PORT,
 * AGENT_WALLET_CONTROL_PORT, AGENT_WALLET_CONTROL_TOKEN.
 */

import { randomBytes } from "node:crypto";
import { AcpClient } from "./acp/acp-client.ts";
import { money } from "./core/types.ts";
import { WalletDaemon } from "./core/wallet.ts";
import { LocalCustody } from "./custody/local-custody.ts";
import { StripeRail } from "./rails/stripe-rail.ts";
import { X402Rail } from "./rails/x402-rail.ts";
import { openWalletDatabase } from "./storage/db.ts";
import { SqliteApprovalStore } from "./storage/sqlite-approval-store.ts";
import { SqliteControlState } from "./storage/sqlite-control-state.ts";
import { SqliteFundingSourceStore } from "./storage/sqlite-funding-store.ts";
import { SqliteLedger } from "./storage/sqlite-ledger.ts";
import { SqliteMandateStore } from "./storage/sqlite-mandate-store.ts";
import { startControlServer } from "./surfaces/control-api.ts";
import { startHttpServer } from "./surfaces/http-api.ts";
import { startHttpMcpServer } from "./surfaces/mcp-server.ts";

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
  funding: new SqliteFundingSourceStore(db),
  // Carts are verified against the merchant's real ACP session before policy.
  cartVerifier: new AcpClient(),
});

const mcpPort = Number(process.env["AGENT_WALLET_MCP_PORT"] ?? 4024);
const payPort = Number(process.env["AGENT_WALLET_PAY_PORT"] ?? 4022);
const controlPort = Number(process.env["AGENT_WALLET_CONTROL_PORT"] ?? 4023);

// The control plane is operator-only. A token is always required — when none
// is configured one is generated, so the control API is never open by default.
// The MCP and payment surfaces are the agent's, and stay unauthenticated:
// they are guarded by the policy engine, and neither can grant authority.
const controlToken =
  process.env["AGENT_WALLET_CONTROL_TOKEN"] ??
  randomBytes(24).toString("base64url");

startHttpMcpServer(wallet, mcpPort);
startHttpServer(wallet, payPort);
startControlServer(wallet, controlPort, controlToken);

console.log("\nagent-wallet daemon ready — one wallet, every surface");
console.log(`  MCP server (HTTP) : http://localhost:${mcpPort}/mcp`);
console.log(`  agent payment API : http://localhost:${payPort}/pay`);
console.log(
  `  control plane + UI: http://localhost:${controlPort}/?token=${controlToken}`,
);
console.log(`  control token     : ${controlToken}\n`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log("\nshutting down");
    db.close();
    process.exit(0);
  });
}
