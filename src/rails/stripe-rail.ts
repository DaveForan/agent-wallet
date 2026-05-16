import type { CustodyProvider } from "../custody/custody.ts";
import { NotImplementedError } from "../core/errors.ts";
import type { Payee, PaymentRequest, RailId } from "../core/types.ts";
import type { PaymentRail, RailQuote, SettlementResult } from "./rail.ts";

export interface StripeRailOptions {
  /** Stripe secret key. Held by the wallet, never exposed to the agent. */
  apiKey?: string;
  /** Cardholder the agent's virtual card is issued to. */
  cardholderId?: string;
}

/**
 * The Stripe fiat rail.
 *
 * Backed by Stripe "Issuing for agents": virtual cards with real-time
 * authorization and spend controls, plus Shared Payment Tokens scoped to a
 * seller, amount and time window.
 *
 * STATUS: stubbed. `supports()` works; `quote()`/`settle()` await SDK wiring.
 */
export class StripeRail implements PaymentRail {
  readonly id: RailId = "stripe";
  private readonly opts: StripeRailOptions;

  constructor(opts: StripeRailOptions = {}) {
    this.opts = opts;
  }

  supports(payee: Payee): boolean {
    // Stripe needs a merchant identifier it can route a card payment to.
    return payee.address.length > 0;
  }

  async quote(_req: PaymentRequest): Promise<RailQuote> {
    throw new NotImplementedError("stripe quote — wire the Stripe SDK");
  }

  async settle(
    _req: PaymentRequest,
    _quote: RailQuote,
    _custody: CustodyProvider,
  ): Promise<SettlementResult> {
    throw new NotImplementedError(
      this.opts.cardholderId
        ? "stripe settle — wire Stripe Issuing authorization"
        : "stripe settle — no cardholderId configured",
    );
  }
}
