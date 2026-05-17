import type { Server } from "node:http";
import type { Payee, PaymentChannel, RailId } from "../core/types.ts";
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

/** Parse an untrusted JSON body into a PaymentInput, restoring the bigint amount. */
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
  };
}
