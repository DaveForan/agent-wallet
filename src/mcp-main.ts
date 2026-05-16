/**
 * Entry point for the agent-wallet MCP server (stdio transport): `npm run mcp`.
 *
 * To use it from an MCP host (Claude Code / Claude Desktop), point the host at:
 *   command: node
 *   args:    ["src/mcp-main.ts"]
 *   cwd:     this repository
 *
 * The wallet below uses tiered autonomy with one sample mandate. Replace this
 * with real configuration (env vars / a config file) once the rails are wired.
 */

import { money } from "./core/types.ts";
import { WalletDaemon } from "./core/wallet.ts";
import { ManagedCustody } from "./custody/managed-custody.ts";
import { StripeRail } from "./rails/stripe-rail.ts";
import { X402Rail } from "./rails/x402-rail.ts";
import { startStdioMcpServer } from "./surfaces/mcp-server.ts";

const wallet = new WalletDaemon({
  policy: {
    mode: "tiered",
    autoApproveThreshold: money(100, "USD"), // auto-approve at or under $1.00
    hardLimit: money(5000, "USD"), // never settle above $50.00
    requireMandate: true, // payments with no mandate are escalated
  },
  rails: [new X402Rail(), new StripeRail()],
  custody: new ManagedCustody(),
});

wallet.createMandate({
  id: "default",
  grantedBy: "dave",
  cap: money(5000, "USD"), // $50.00 lifetime
  perTxnCap: money(1000, "USD"), // $10.00 per payment
  rails: ["x402", "stripe"],
});

startStdioMcpServer(wallet).catch((err: unknown) => {
  console.error("agent-wallet MCP server failed to start:", err);
  process.exitCode = 1;
});
