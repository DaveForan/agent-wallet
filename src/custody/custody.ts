import type { RailId } from "../core/types.ts";

/** A request for the custody layer to authorize a rail operation. */
export interface SigningRequest {
  rail: RailId;
  /** Rail-specific payload: bytes to sign, or a charge to authorize. */
  payload: unknown;
}

/** The result of a custody authorization. */
export interface Authorization {
  /** Signature, token, or authorization id the rail needs to settle. */
  signature: string;
  /** Raw provider response. */
  raw?: unknown;
}

/**
 * CustodyProvider abstracts *where keys and funds live* away from the rails.
 *
 * v1 ships a managed provider (Coinbase CDP / cloud KMS). Self-custody is the
 * other backend behind this same interface — chosen later, with no rail
 * changes required.
 */
export interface CustodyProvider {
  readonly kind: "managed" | "local";
  /** Stable funding-source id for a rail: a wallet address, a cardholder id. */
  account(rail: RailId): Promise<string>;
  /** Produce the signature / authorization a rail needs to settle. */
  authorize(request: SigningRequest): Promise<Authorization>;
}
