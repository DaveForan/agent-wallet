import { randomUUID } from "node:crypto";
import { WalletError } from "../core/errors.ts";
import { guardedFetch } from "../core/net-guard.ts";
import type { Cart } from "../core/types.ts";
import type { CartVerifier } from "../core/verification.ts";
import type { AcpCheckoutSession, AcpOrderResult } from "./types.ts";

/** The ACP checkout spec version this client targets. */
const ACP_SPEC_VERSION = "2026-04-17";

export interface AcpClientOptions {
  /** ACP spec version sent in the API-Version header. */
  specVersion?: string;
  /** fetch implementation — injectable for tests. Defaults to a guarded fetch. */
  fetchImpl?: typeof fetch;
  /** Allow loopback / private merchant endpoints — for local testing only. */
  allowPrivate?: boolean;
}

/**
 * A client for the Agentic Commerce Protocol Checkout API.
 *
 * The wallet uses it for two things: (a) verify a cart by fetching the
 * merchant's authoritative session *directly* — never trusting the agent's
 * claimed line items or total — and (b) complete a purchase with a payment
 * token. It implements {@link CartVerifier}, so the daemon can replace an
 * agent-supplied cart with the verified one before policy ever sees it.
 */
export class AcpClient implements CartVerifier {
  private readonly specVersion: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AcpClientOptions = {}) {
    this.specVersion = opts.specVersion ?? ACP_SPEC_VERSION;
    this.fetchImpl =
      opts.fetchImpl ?? guardedFetch({ allowPrivate: opts.allowPrivate });
  }

  /** Create a checkout session with a merchant (the agent builds the cart). */
  async createSession(
    endpoint: string,
    request: unknown,
  ): Promise<AcpCheckoutSession> {
    const res = await this.fetchImpl(
      `${trimSlash(endpoint)}/checkout_sessions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "API-Version": this.specVersion,
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify(request),
      },
    );
    if (!res.ok) {
      throw new WalletError(`ACP create-session: HTTP ${res.status}`);
    }
    return (await res.json()) as AcpCheckoutSession;
  }

  /** Fetch a merchant's checkout session. */
  async getSession(
    endpoint: string,
    sessionId: string,
  ): Promise<AcpCheckoutSession> {
    const res = await this.fetchImpl(
      `${trimSlash(endpoint)}/checkout_sessions/${encodeURIComponent(sessionId)}`,
      { headers: { accept: "application/json", "API-Version": this.specVersion } },
    );
    if (!res.ok) {
      throw new WalletError(`ACP get-session ${sessionId}: HTTP ${res.status}`);
    }
    return (await res.json()) as AcpCheckoutSession;
  }

  /**
   * Verify a cart against the merchant's real session. Returns the cart as the
   * merchant states it — the agent's claimed line items and total are discarded.
   */
  async verify(cart: Cart): Promise<Cart> {
    const endpoint = cart.merchant.acpEndpoint;
    if (!endpoint) {
      throw new WalletError(
        "cart has no merchant ACP endpoint to verify against",
      );
    }
    if (!/^https:\/\//i.test(endpoint)) {
      throw new WalletError(`ACP endpoint must be https: ${endpoint}`);
    }
    const session = await this.getSession(endpoint, cart.sessionId);
    if (session.status !== "ready_for_payment") {
      throw new WalletError(
        `ACP session ${cart.sessionId} is "${session.status}", not ready ` +
          `for payment`,
      );
    }
    return sessionToCart(session, cart.merchant, endpoint);
  }

  /** Complete a checkout session with a Shared Payment Token. */
  async completePurchase(
    endpoint: string,
    sessionId: string,
    sptToken: string,
  ): Promise<AcpOrderResult> {
    const res = await this.fetchImpl(
      `${trimSlash(endpoint)}/checkout_sessions/${encodeURIComponent(sessionId)}/complete`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "API-Version": this.specVersion,
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          payment_data: {
            instrument: {
              type: "card",
              credential: { type: "spt", token: sptToken },
            },
          },
        }),
      },
    );
    if (!res.ok) {
      throw new WalletError(`ACP complete ${sessionId}: HTTP ${res.status}`);
    }
    return (await res.json()) as AcpOrderResult;
  }
}

/** Map a verified ACP session to the wallet's Cart. */
export function sessionToCart(
  session: AcpCheckoutSession,
  merchant: Cart["merchant"],
  endpoint: string,
): Cart {
  const total = session.totals.find((t) => t.type === "total");
  if (!total) {
    throw new WalletError(`ACP session ${session.id} has no "total"`);
  }
  return {
    sessionId: session.id,
    merchant: { id: merchant.id, name: merchant.name, acpEndpoint: endpoint },
    lineItems: session.line_items.map((li) => ({
      id: li.id,
      name: li.name ?? li.item?.name ?? "item",
      quantity: li.quantity,
      unitPrice: {
        amount: BigInt(li.unit_amount ?? li.item?.unit_amount ?? 0),
        currency: session.currency,
      },
      category: li.item?.category,
    })),
    total: { amount: BigInt(total.amount), currency: session.currency },
  };
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
