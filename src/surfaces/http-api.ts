import type { Server } from "node:http";
import type { Cart, Payee, PaymentChannel, RailId } from "../core/types.ts";
import type { PaymentInput, WalletDaemon } from "../core/wallet.ts";
import { parseMoney, serve, type HttpResult } from "./http-util.ts";

/**
 * Agent-facing HTTP surface — for non-MCP agents.
 *
 * It exposes exactly one capability: requesting a payment. Operator controls
 * (mandates, freeze, approvals) live on the separate control API
 * (`control-api.ts`), so an agent that can reach this surface still cannot
 * grant itself spending authority or lift a freeze.
 *
 *   POST /pay   request a payment
 */
export async function routeAgentRequest(
  wallet: WalletDaemon,
  method: string,
  path: string,
  body: unknown,
): Promise<HttpResult> {
  if (method === "POST" && path === "/pay") {
    return { status: 200, body: await wallet.pay(parsePaymentInput(body)) };
  }
  return { status: 404, body: { error: `no route for ${method} ${path}` } };
}

/** Start the agent payment surface. */
export function startHttpServer(wallet: WalletDaemon, port = 4022): Server {
  return serve(
    "payment API",
    (method, path, _query, body) =>
      routeAgentRequest(wallet, method, path, body),
    port,
  );
}

/** Parse an untrusted JSON body into a PaymentInput, restoring bigint amounts. */
function parsePaymentInput(raw: unknown): PaymentInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    rail: r["rail"] as RailId,
    amount: parseMoney(r["amount"]),
    payee: r["payee"] as Payee,
    memo: r["memo"] === undefined ? undefined : String(r["memo"]),
    mandateId:
      r["mandateId"] === undefined ? undefined : String(r["mandateId"]),
    channel: r["channel"] as PaymentChannel | undefined,
    cart: parseCart(r["cart"]),
  };
}

/** Parse a cart, restoring the bigint amounts JSON cannot carry. */
function parseCart(raw: unknown): Cart | undefined {
  if (raw === undefined || raw === null) return undefined;
  const c = raw as Record<string, unknown>;
  const items = Array.isArray(c["lineItems"]) ? c["lineItems"] : [];
  return {
    sessionId: String(c["sessionId"]),
    merchant: (c["merchant"] ?? {}) as { id: string; name?: string },
    lineItems: items.map((entry) => {
      const i = entry as Record<string, unknown>;
      return {
        id: String(i["id"]),
        name: String(i["name"]),
        quantity: Number(i["quantity"]),
        unitPrice: parseMoney(i["unitPrice"]),
        category: i["category"] === undefined ? undefined : String(i["category"]),
        sku: i["sku"] === undefined ? undefined : String(i["sku"]),
      };
    }),
    total: parseMoney(c["total"]),
  };
}
