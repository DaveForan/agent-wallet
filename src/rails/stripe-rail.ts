import Stripe from "stripe";
import type { CustodyProvider } from "../custody/custody.ts";
import { WalletError } from "../core/errors.ts";
import type { Payee, PaymentRequest, RailId } from "../core/types.ts";
import type { PaymentRail, RailQuote, SettlementResult } from "./rail.ts";

export interface StripeRailOptions {
  /**
   * Stripe secret key. Falls back to STRIPE_SECRET_KEY. Use a test-mode key
   * (`sk_test_...`) for development — no real money moves.
   */
  apiKey?: string;
  /**
   * Issuing cardholder the cards are issued to. Falls back to
   * STRIPE_ISSUING_CARDHOLDER. When unset, a cardholder is created on demand.
   */
  cardholderId?: string;
}

/**
 * The Stripe fiat rail, backed by Stripe "Issuing for agents".
 *
 * A card rail has no on-chain settlement event. Instead, `settle()` provisions
 * the payment: it issues a **single-use virtual card** whose per-authorization
 * spend limit is locked to the authorized amount, so Stripe itself enforces
 * the cap and the card cannot be reused. The merchant charge then happens
 * asynchronously through Stripe's real-time authorization.
 *
 * The `SettlementResult.reference` is the Stripe card id; the card's number
 * and CVC are deliberately not returned here — retrieving them is a separate,
 * sensitive operation and must not flow through the audit ledger.
 */
export class StripeRail implements PaymentRail {
  readonly id: RailId = "stripe";

  private readonly apiKey: string | undefined;
  private readonly configuredCardholder: string | undefined;
  /** Memoised client and on-demand cardholder. */
  private stripe: Stripe | undefined;
  private createdCardholder: string | undefined;

  constructor(opts: StripeRailOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env["STRIPE_SECRET_KEY"];
    this.configuredCardholder =
      opts.cardholderId ?? process.env["STRIPE_ISSUING_CARDHOLDER"];
  }

  /** Stripe can route a card payment to any merchant with an identifier. */
  supports(payee: Payee): boolean {
    return payee.address.length > 0;
  }

  /**
   * A card rail has no merchant price-discovery step: the wallet sets the
   * amount and Stripe enforces it as the card's spend cap. The quote simply
   * echoes the request.
   */
  async quote(req: PaymentRequest): Promise<RailQuote> {
    return {
      total: req.amount,
      fee: { amount: 0n, currency: req.amount.currency },
      quoteRef: req.payee.address,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }

  /** Issue a single-use virtual card capped at the authorized amount. */
  async settle(
    req: PaymentRequest,
    _quote: RailQuote,
    _custody: CustodyProvider,
  ): Promise<SettlementResult> {
    const stripe = this.client();
    try {
      const cardholder = await this.cardholder(stripe);
      const card = await stripe.issuing.cards.create({
        cardholder,
        currency: req.amount.currency.toLowerCase(),
        type: "virtual",
        status: "active",
        // Auto-cancel the card after a single successful authorization.
        lifecycle_controls: { cancel_after: { payment_count: 1 } },
        spending_controls: {
          // Stripe enforces this cap on the one charge the card permits.
          spending_limits: [
            {
              amount: Number(req.amount.amount),
              interval: "per_authorization",
            },
          ],
        },
        metadata: {
          paymentId: req.id,
          payee: req.payee.address,
          ...(req.memo ? { memo: req.memo } : {}),
        },
      });

      return {
        settled: true,
        reference: card.id,
        settledAmount: req.amount,
        raw: {
          cardId: card.id,
          last4: card.last4,
          brand: card.brand,
          expMonth: card.exp_month,
          expYear: card.exp_year,
          status: card.status,
          spendLimit: Number(req.amount.amount),
        },
      };
    } catch (err) {
      throw new WalletError(
        `stripe settle: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private client(): Stripe {
    if (!this.apiKey) {
      throw new WalletError(
        "stripe rail has no API key — set STRIPE_SECRET_KEY (sk_test_... for " +
          "test mode)",
      );
    }
    return (this.stripe ??= new Stripe(this.apiKey));
  }

  /** Resolve the cardholder, creating one on first use if none is configured. */
  private async cardholder(stripe: Stripe): Promise<string> {
    if (this.configuredCardholder) return this.configuredCardholder;
    if (this.createdCardholder) return this.createdCardholder;

    const cardholder = await stripe.issuing.cardholders.create({
      type: "individual",
      name: "agent-wallet agent",
      email: "agent@example.com",
      billing: {
        address: {
          line1: "1 Agent Way",
          city: "San Francisco",
          state: "CA",
          postal_code: "94105",
          country: "US",
        },
      },
    });
    this.createdCardholder = cardholder.id;
    return cardholder.id;
  }
}
