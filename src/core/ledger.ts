/**
 * Append-only audit ledger. Every decision and state change a payment goes
 * through is recorded here — this is the wallet's accountability backbone.
 *
 * The in-memory implementation is for development; the `Ledger` interface is
 * the seam for a durable backend (SQLite, Postgres, an event store) later.
 */

export type LedgerEventType =
  | "payment.requested"
  | "policy.decided"
  | "approval.requested"
  | "approval.resolved"
  | "payment.settled"
  | "payment.failed"
  | "mandate.created"
  | "mandate.revoked";

export interface LedgerEvent {
  /** Monotonic sequence number, unique and ordered. */
  seq: number;
  /** ISO-8601 timestamp. */
  at: string;
  type: LedgerEventType;
  /** Correlates every event belonging to one payment. */
  paymentId?: string;
  /** Event-specific payload. */
  data: Record<string, unknown>;
}

export interface Ledger {
  append(
    type: LedgerEventType,
    data: Record<string, unknown>,
    paymentId?: string,
  ): LedgerEvent;
  /** All events, or just those for one payment when `paymentId` is given. */
  history(paymentId?: string): LedgerEvent[];
}

/** Development ledger. Events live in process memory and are lost on restart. */
export class InMemoryLedger implements Ledger {
  private readonly events: LedgerEvent[] = [];
  private seq = 0;

  append(
    type: LedgerEventType,
    data: Record<string, unknown>,
    paymentId?: string,
  ): LedgerEvent {
    const event: LedgerEvent = {
      seq: ++this.seq,
      at: new Date().toISOString(),
      type,
      paymentId,
      data,
    };
    this.events.push(event);
    return event;
  }

  history(paymentId?: string): LedgerEvent[] {
    if (paymentId === undefined) return [...this.events];
    return this.events.filter((e) => e.paymentId === paymentId);
  }
}
