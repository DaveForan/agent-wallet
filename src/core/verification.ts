import type { Cart } from "./types.ts";

/**
 * Verifies an agent-supplied cart against the merchant's authoritative
 * checkout session.
 *
 * The agent is untrusted — it could fabricate or alter a cart to slip a
 * payment past policy. So before the policy engine ever sees a cart, the
 * wallet replaces it with what the merchant *actually* states. The implementor
 * (the ACP client) fetches the session directly from the merchant.
 */
export interface CartVerifier {
  /**
   * Fetch the merchant's real session for `cart` and return the cart as the
   * merchant states it. Throws if the session cannot be verified or is not
   * ready for payment.
   */
  verify(cart: Cart): Promise<Cart>;
}
