import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AcpClient } from "../acp/acp-client.ts";
import { bigintReplacer } from "../core/types.ts";
import type { PayResult, WalletDaemon } from "../core/wallet.ts";
import { bearerToken } from "./http-util.ts";

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
  acpClient?: AcpClient,
  agentId?: string,
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
          .enum(["x402", "stripe", "acp"])
          .describe(
            "Payment rail: 'x402' crypto, 'stripe' virtual card, " +
              "'acp' agentic checkout.",
          ),
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
        agentId,
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

  if (acpClient) registerAcpTools(server, wallet, acpClient, agentId);
}

/**
 * Register the agentic-checkout tools — the agent builds a cart with an ACP
 * merchant, then hands the session to the wallet to verify and pay.
 */
function registerAcpTools(
  server: McpServer,
  wallet: WalletDaemon,
  acp: AcpClient,
  agentId?: string,
): void {
  server.registerTool(
    "acp_create_checkout",
    {
      title: "Create an agentic checkout",
      description:
        "Open a checkout session with an ACP merchant for the chosen items. " +
        "Returns the session id, line items and total — then use pay_checkout.",
      inputSchema: {
        merchantEndpoint: z
          .string()
          .url()
          .describe("Base URL of the merchant's ACP checkout API."),
        currency: z.string().min(1).describe('e.g. "USD".'),
        items: z
          .array(
            z.object({
              itemId: z.string().describe("The merchant's product/SKU id."),
              quantity: z.number().int().positive(),
            }),
          )
          .min(1)
          .describe("The items to put in the cart."),
        buyerEmail: z.string().optional().describe("Buyer contact email."),
      },
    },
    async (args) => {
      const session = await acp.createSession(args.merchantEndpoint, {
        currency: args.currency,
        line_items: args.items.map((it) => ({
          item: { id: it.itemId },
          quantity: it.quantity,
        })),
        buyer: { email: args.buyerEmail ?? "agent@agent-wallet.local" },
      });
      return textResult(session);
    },
  );

  server.registerTool(
    "acp_update_checkout",
    {
      title: "Update an agentic checkout",
      description:
        "Replace the items on an existing ACP checkout session — to refine " +
        "the cart before paying. Returns the updated session.",
      inputSchema: {
        merchantEndpoint: z.string().url(),
        sessionId: z.string().min(1),
        items: z
          .array(
            z.object({
              itemId: z.string().describe("The merchant's product/SKU id."),
              quantity: z.number().int().positive(),
            }),
          )
          .min(1)
          .describe("The cart's items after the update."),
      },
    },
    async (args) => {
      const session = await acp.updateSession(
        args.merchantEndpoint,
        args.sessionId,
        {
          line_items: args.items.map((it) => ({
            item: { id: it.itemId },
            quantity: it.quantity,
          })),
        },
      );
      return textResult(session);
    },
  );

  server.registerTool(
    "acp_checkout_status",
    {
      title: "Get an agentic checkout's status",
      description: "Fetch the current state of an ACP checkout session.",
      inputSchema: {
        merchantEndpoint: z.string().url(),
        sessionId: z.string().min(1),
      },
    },
    async (args) =>
      textResult(await acp.getSession(args.merchantEndpoint, args.sessionId)),
  );

  server.registerTool(
    "pay_checkout",
    {
      title: "Pay an agentic checkout",
      description:
        "Pay a merchant's ACP checkout session. The wallet re-fetches and " +
        "verifies the session, runs policy, and settles — the outcome is " +
        "'settled', 'denied' or 'pending_approval'.",
      inputSchema: {
        merchantEndpoint: z.string().url(),
        merchantId: z.string().min(1),
        merchantName: z.string().optional(),
        sessionId: z.string().min(1).describe("The checkout session to pay."),
        maxAmount: z
          .string()
          .regex(/^\d+$/, "must be an integer in minor units")
          .describe("Authorized ceiling, in minor units."),
        currency: z.string().min(1),
        mandateId: z.string().optional(),
        memo: z.string().optional(),
      },
    },
    async (args) => {
      // The cart is just a pointer — the wallet replaces it with the
      // merchant's verified session before policy sees it.
      const result = await wallet.pay({
        rail: "acp",
        channel: "deliberate",
        amount: { amount: BigInt(args.maxAmount), currency: args.currency },
        payee: { address: args.merchantId, label: args.merchantName },
        memo: args.memo,
        mandateId: args.mandateId,
        agentId,
        cart: {
          sessionId: args.sessionId,
          merchant: {
            id: args.merchantId,
            name: args.merchantName,
            acpEndpoint: args.merchantEndpoint,
          },
          lineItems: [],
          total: { amount: 0n, currency: args.currency },
        },
      });
      return textResult({ summary: summarize(result), result });
    },
  );
}

/** Build an McpServer with the wallet's tools registered. */
export function createWalletMcpServer(
  wallet: WalletDaemon,
  acpClient?: AcpClient,
  agentId?: string,
): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerWalletTools(server, wallet, acpClient, agentId);
  return server;
}

/**
 * Start the wallet's MCP server over stdio.
 *
 * Logs go to stderr — stdout is reserved for the JSON-RPC message stream and
 * must not be written to directly.
 */
export async function startStdioMcpServer(
  wallet: WalletDaemon,
  acpClient?: AcpClient,
): Promise<void> {
  const server = createWalletMcpServer(wallet, acpClient);
  await server.connect(new StdioServerTransport());
  console.error("agent-wallet MCP server ready on stdio");
}

/**
 * Serve the wallet's MCP server over Streamable HTTP at `POST /mcp`.
 *
 * Runs stateless: a fresh McpServer and transport are created per request,
 * all closing over the one shared WalletDaemon. This is what lets the MCP
 * surface run in the same process as the control and payment surfaces — every
 * surface drives the same wallet.
 */
export function startHttpMcpServer(
  wallet: WalletDaemon,
  port = 4024,
  acpClient?: AcpClient,
): Server {
  const server = createServer((req, res) => {
    void handleHttpMcp(wallet, acpClient, req, res);
  });
  // Loopback only — the MCP surface is unauthenticated (policy gates it).
  server.listen(port, "127.0.0.1", () => {
    console.log(`agent-wallet MCP (HTTP) on http://localhost:${port}/mcp`);
  });
  return server;
}

/** Largest MCP request body accepted — MCP JSON-RPC messages are small. */
const MAX_MCP_BODY_BYTES = 1_000_000;

async function handleHttpMcp(
  wallet: WalletDaemon,
  acpClient: AcpClient | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path !== "/mcp") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found — the MCP endpoint is /mcp" }));
    return;
  }
  if (Number(req.headers["content-length"] ?? 0) > MAX_MCP_BODY_BYTES) {
    res.writeHead(413, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "request body too large" }));
    return;
  }

  // When agents are registered, the MCP surface requires a valid agent token;
  // the resolved id is bound to every payment the request makes.
  let agentId: string | undefined;
  if (wallet.hasAgents()) {
    const token = bearerToken(req.headers);
    agentId = token ? wallet.authenticateAgent(token) : undefined;
    if (!agentId) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: "a valid agent bearer token is required" }),
      );
      return;
    }
  }

  // Stateless: one server + transport per request, sharing the one wallet.
  const mcp = createWalletMcpServer(wallet, acpClient, agentId);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    void transport.close();
    void mcp.close();
  });

  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}
