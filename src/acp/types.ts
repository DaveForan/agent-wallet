/**
 * Types for the Agentic Commerce Protocol (ACP) Checkout API, spec 2026-04-17.
 *
 * Only the subset the wallet reads is modelled. ACP monetary amounts are
 * integers in minor currency units (e.g. 100 = $1.00).
 */

/** A line item in an ACP checkout session. */
export interface AcpLineItem {
  id: string;
  name?: string;
  quantity: number;
  unit_amount?: number;
  item?: { id?: string; name?: string; unit_amount?: number; category?: string };
}

/** One entry in a session's totals breakdown; `type: "total"` is what's charged. */
export interface AcpTotal {
  type: string;
  amount: number;
  display_text?: string;
}

/** A merchant's authoritative checkout session. */
export interface AcpCheckoutSession {
  id: string;
  status: string;
  currency: string;
  line_items: AcpLineItem[];
  totals: AcpTotal[];
}

/** The result of completing a checkout — carries the merchant's order. */
export interface AcpOrderResult {
  id?: string;
  status?: string;
  order?: { id?: string; status?: string };
}
