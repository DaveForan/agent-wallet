import Stripe from "stripe";
import type { AcpClient } from "../acp/acp-client.ts";
import { WalletError } from "../core/errors.ts";
import type { FundingSourceStore } from "../core/funding.ts";
import type { Money, Payee, PaymentRequest, RailId } from "../core/types.ts";
import type { CustodyProvider } from "../custody/custody.ts";
import type { PaymentRail, RailQuote, SettlementResult } from "./rail.ts";

/** Stripe API version that exposes the preview Shared Payment Token API. */
const SPT_STRIPE_VERSION = "2026-04-22.preview";
/** Default validity window for a minted token. */
const DEFAULT_TOKEN_TTL_SECONDS = 600;

/**
 * Minimal shape of the Stripe Shared Payment Token API. The installed SDK does
 * not type this preview API, so the client is cast to this interface — the
 * runtime call is exactly what the Stripe agentic-commerce docs specify.
 */
interface StripeSptApi {
  sharedPayment: {
    issuedTokens: {
      create(
        params: {
          payment_method: string;
          seller_details: { network_business_profile: string };
          usage_limits: {
            currency: string;
            max_amount: number;
            expires_at: number;
          };
          return_url: string;
        },
        options: { stripeVersion: string },
      ): Promise<{ id: string; status?: string }>;
    };
  };
}

export interface AcpCheckoutRailOptions {
  /** Stripe secret key. Falls back to STRIPE_SECRET_KEY. */
  apiKey?: string;
  /** The funding source the token is minted against. */
  fundingStore: FundingSourceStore;
  /** ACP client used to complete the purchase. */
  acpClient: AcpClient;
  /** Token validity window, in seconds. Defaults to 10 minutes. */
  tokenTtlSeconds?: number;
}

/**
 * The agentic-checkout rail.
 *
 * `settle()` pays a verified ACP cart: it mints a Stripe Shared Payment Token
 * scoped to *(this merchant, this cart total, a short TTL)* against the
 * wallet's funding source, then completes the merchant's ACP checkout session
 * with that token. The token's three constraints — merchant, amount, expiry —
 * are the policy decision made concrete; the merchant never receives a card
 * number, and the agent never holds a reusable credential.
 */
export class AcpCheckoutRail implements PaymentRail {
  readonly id: RailId = "acp";

  private readonly apiKey: string | undefined;
  private readonly fundingStore: FundingSourceStore;
  private readonly acpClient: AcpClient;
  private readonly ttlSeconds: number;
  private stripe: Stripe | undefined;

  constructor(opts: AcpCheckoutRailOptions) {
    this.apiKey = opts.apiKey ?? process.env["STRIPE_SECRET_KEY"];
    this.fundingStore = opts.fundingStore;
    this.acpClient = opts.acpClient;
    this.ttlSeconds = opts.tokenTtlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS;
  }

  /** The ACP rail pays merchant checkout sessions, identified by the cart. */
  supports(payee: Payee): boolean {
    return payee.address.length > 0;
  }

  /** No price-discovery step — the verified cart already carries the total. */
  async quote(req: PaymentRequest): Promise<RailQuote> {
    const total: Money = req.cart ? req.cart.total : req.amount;
    return {
      total,
      fee: { amount: 0n, currency: total.currency },
      quoteRef: req.cart?.sessionId ?? "",
      expiresAt: new Date(Date.now() + this.ttlSeconds * 1000).toISOString(),
    };
  }

  /** Mint a Shared Payment Token for the cart and complete the ACP checkout. */
  async settle(
    req: PaymentRequest,
    _quote: RailQuote,
    _custody: CustodyProvider,
  ): Promise<SettlementResult> {
    const cart = req.cart;
    const unsettled = (error: string): SettlementResult => ({
      settled: false,
      reference: "",
      settledAmount: cart?.total ?? req.amount,
      raw: { error },
    });

    if (!cart) return unsettled("the acp rail requires a verified cart");
    const funding = this.fundingStore.get();
    if (!funding) return unsettled("no funding source is registered");
    const { acpEndpoint, networkBusinessProfile } = cart.merchant;
    if (!networkBusinessProfile) {
      return unsettled("the cart's merchant has no Stripe business profile");
    }
    if (!acpEndpoint) {
      return unsettled("the cart's merchant has no ACP endpoint");
    }

    try {
      // Mint a Shared Payment Token scoped to this merchant and this total.
      const spt = await this.spt().sharedPayment.issuedTokens.create(
        {
          payment_method: funding.paymentMethodId,
          seller_details: { network_business_profile: networkBusinessProfile },
          usage_limits: {
            currency: cart.total.currency.toLowerCase(),
            max_amount: Number(cart.total.amount),
            expires_at: Math.floor(Date.now() / 1000) + this.ttlSeconds,
          },
          return_url: "https://agent-wallet.local/acp/return",
        },
        { stripeVersion: SPT_STRIPE_VERSION },
      );

      // Complete the merchant's checkout session with the token.
      const order = await this.acpClient.completePurchase(
        acpEndpoint,
        cart.sessionId,
        spt.id,
      );
      const reference = order.order?.id ?? order.id ?? spt.id;

      // Reconcile: record what the merchant actually charged. The SPT was
      // scoped to the cart total, so the charge can never exceed it.
      const charged = order.totals?.find((t) => t.type === "total");
      const settledAmount: Money = charged
        ? { amount: BigInt(charged.amount), currency: cart.total.currency }
        : cart.total;

      return {
        settled: true,
        reference,
        settledAmount,
        order: { id: reference, sessionId: cart.sessionId },
        raw: { sptId: spt.id, orderId: reference, sessionId: cart.sessionId },
      };
    } catch (err) {
      throw new WalletError(
        `acp settle: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private spt(): StripeSptApi {
    if (!this.apiKey) {
      throw new WalletError(
        "acp rail has no Stripe API key — set STRIPE_SECRET_KEY",
      );
    }
    this.stripe ??= new Stripe(this.apiKey);
    return this.stripe as unknown as StripeSptApi;
  }
}
