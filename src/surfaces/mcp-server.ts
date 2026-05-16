import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { bigintReplacer } from "../core/types.ts";
import type { PayResult, WalletDaemon } from "../core/wallet.ts";

/**
 * MCP surface — the *deliberate* payment interface.
 *
 * This wires the wallet to a real `@modelcontextprotocol/sdk` server. The
 * tools an MCP-capable agent (Claude included) sees are registered here.
 *
 * Note the asymmetry: an agent may *request* a payment and *read* state, but
 * it can never *approve* one — approval lives on the human-facing HTTP
 * surface by design, so a compromised agent cannot self-authorize spend.
 */

const SERVER_INFO = { name: "agent-wallet", version: "0.0.1" } as const;

/** Wrap any wallet result as an MCP text-content response. */
function textResult(payload: unknown): CallToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify(payload, bigintReplacer, 2) },
    ],
  };
}

/** A one-line, human-readable summary of a pay() outcome for the agent. */
function summarize(result: PayResult): string {
  switch (result.status) {
    case "settled":
      return `Settled. Rail reference: ${result.settlement.reference}.`;
    case "denied":
      return `Denied by policy: ${result.reason}`;
    case "failed":
      return `Payment failed: ${result.reason}`;
    case "pending_approval":
      return `Awaiting human approval (id ${result.approvalId}): ${result.reason}`;
  }
}

/**
 * Register the wallet's tools on an McpServer. Exposed separately so the same
 * tools can be mounted on any transport (stdio, streamable HTTP, in-memory).
 */
export function registerWalletTools(
  server: McpServer,
  wallet: WalletDaemon,
): void {
  server.registerTool(
    "request_payment",
    {
      title: "Request a payment",
      description:
        "Request a payment to a payee. The wallet's policy engine decides the " +
        "outcome — 'settled', 'denied', or 'pending_approval'. The agent " +
        "cannot override that decision; a denial explains why so you can adjust.",
      inputSchema: {
        rail: z
          .enum(["x402", "stripe"])
          .describe("Payment rail: 'x402' for crypto, 'stripe' for card."),
        amount: z
          .string()
          .regex(/^\d+$/, "must be an integer in minor units")
          .describe("Amount in minor units — cents, or atomic token units."),
        currency: z.string().min(1).describe('e.g. "USD" or "USDC".'),
        payeeAddress: z
          .string()
          .min(1)
          .describe("Rail-specific destination: address, host, or merchant id."),
        payeeLabel: z.string().optional().describe("Human-readable payee name."),
        memo: z.string().optional().describe("Why this payment is needed."),
        mandateId: z
          .string()
          .optional()
          .describe("Mandate to draw the spend against, if any."),
      },
    },
    async (args) => {
      const result = await wallet.pay({
        rail: args.rail,
        channel: "deliberate",
        amount: { amount: BigInt(args.amount), currency: args.currency },
        payee: { address: args.payeeAddress, label: args.payeeLabel },
        memo: args.memo,
        mandateId: args.mandateId,
      });
      return textResult({ summary: summarize(result), result });
    },
  );

  server.registerTool(
    "get_payment_status",
    {
      title: "Get payment status",
      description: "Fetch the full audit trail for a payment by its id.",
      inputSchema: {
        paymentId: z
          .string()
          .min(1)
          .describe("The payment id returned by request_payment."),
      },
    },
    async (args) => textResult(wallet.audit(args.paymentId)),
  );

  server.registerTool(
    "list_mandates",
    {
      title: "List mandates",
      description:
        "List the spending mandates currently available to the agent.",
    },
    async () => textResult(wallet.listMandates()),
  );
}

/** Build an McpServer with the wallet's tools registered. */
export function createWalletMcpServer(wallet: WalletDaemon): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerWalletTools(server, wallet);
  return server;
}

/**
 * Start the wallet's MCP server over stdio.
 *
 * Logs go to stderr — stdout is reserved for the JSON-RPC message stream and
 * must not be written to directly.
 */
export async function startStdioMcpServer(wallet: WalletDaemon): Promise<void> {
  const server = createWalletMcpServer(wallet);
  await server.connect(new StdioServerTransport());
  console.error("agent-wallet MCP server ready on stdio");
}
