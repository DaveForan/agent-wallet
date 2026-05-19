/**
 * Append-only audit ledger. Every decision and state change a payment goes
 * through is recorded here — this is the wallet's accountability backbone.
 *
 * Events are **hash-chained**: each carries a SHA-256 hash over its content
 * and the previous event's hash, so any edit, deletion or reorder of the
 * stored ledger is detectable via `verifyIntegrity()`.
 */

import { createHash } from "node:crypto";
import type { LedgerSigner } from "./ledger-signer.ts";
import { bigintReplacer } from "./types.ts";

export type LedgerEventType =
  | "payment.requested"
  | "policy.decided"
  | "payment.blocked"
  | "approval.requested"
  | "approval.resolved"
  | "approval.expired"
  | "payment.settled"
  | "payment.failed"
  | "mandate.created"
  | "mandate.revoked"
  | "wallet.frozen"
  | "wallet.unfrozen"
  | "funding.registered"
  | "funding.cleared"
  | "agent.registered"
  | "agent.revoked";

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
  /** SHA-256 hash chaining this event to the previous one. */
  hash: string;
  /** Signature over `hash`, when a ledger signer is configured. */
  signature?: string;
  /** Id of the key that produced `signature`. */
  keyId?: string;
}

/** The result of checking the ledger's integrity. */
export interface LedgerIntegrity {
  ok: boolean;
  events: number;
  /** Sequence number of the first event that does not verify. */
  brokenAt?: number;
  /** Why verification failed, when it did. */
  reason?: string;
}

/** The previous-hash value for the very first event. */
export const GENESIS_HASH = "0".repeat(64);

/** Compute an event's tamper-evident hash, chained to `prevHash`. */
export function hashLedgerEvent(
  fields: {
    seq: number;
    at: string;
    type: string;
    paymentId?: string;
    data: Record<string, unknown>;
  },
  prevHash: string,
): string {
  const canonical = [
    String(fields.seq),
    fields.at,
    fields.type,
    fields.paymentId ?? "",
    JSON.stringify(fields.data, bigintReplacer),
    prevHash,
  ].join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Walk events in order and confirm each event's chained hash. When a `signer`
 * is given, every event must also carry a signature that verifies under it.
 */
export function checkChain(
  events: LedgerEvent[],
  signer?: LedgerSigner,
): LedgerIntegrity {
  let prevHash = GENESIS_HASH;
  for (const event of events) {
    if (event.hash !== hashLedgerEvent(event, prevHash)) {
      return {
        ok: false,
        events: events.length,
        brokenAt: event.seq,
        reason: "hash mismatch",
      };
    }
    if (signer) {
      const signed =
        event.signature !== undefined &&
        event.keyId !== undefined &&
        signer.verify(event.hash, event.signature, event.keyId);
      if (!signed) {
        return {
          ok: false,
          events: events.length,
          brokenAt: event.seq,
          reason: "signature missing or invalid",
        };
      }
    }
    prevHash = event.hash;
  }
  return { ok: true, events: events.length };
}

export interface Ledger {
  append(
    type: LedgerEventType,
    data: Record<string, unknown>,
    paymentId?: string,
  ): LedgerEvent;
  /** All events, or just those for one payment when `paymentId` is given. */
  history(paymentId?: string): LedgerEvent[];
  /**
   * Events of one type, optionally only those at or after `sinceIso` (an
   * ISO-8601 timestamp). A durable backend can answer this from an index;
   * it keeps hot-path reads off a full ledger scan.
   */
  eventsByType(type: LedgerEventType, sinceIso?: string): LedgerEvent[];
  /** Verify the hash chain — detects any tampering with the stored ledger. */
  verifyIntegrity(): LedgerIntegrity;
}

/** Development ledger. Events live in process memory and are lost on restart. */
export class InMemoryLedger implements Ledger {
  private readonly events: LedgerEvent[] = [];
  private seq = 0;
  private readonly signer: LedgerSigner | undefined;

  /** An optional signer signs every event's hash. */
  constructor(signer?: LedgerSigner) {
    this.signer = signer;
  }

  append(
    type: LedgerEventType,
    data: Record<string, unknown>,
    paymentId?: string,
  ): LedgerEvent {
    const seq = ++this.seq;
    const at = new Date().toISOString();
    const prevHash = this.events.at(-1)?.hash ?? GENESIS_HASH;
    const hash = hashLedgerEvent({ seq, at, type, paymentId, data }, prevHash);
    const event: LedgerEvent = { seq, at, type, paymentId, data, hash };
    if (this.signer) {
      event.signature = this.signer.sign(hash);
      event.keyId = this.signer.keyId;
    }
    this.events.push(event);
    return event;
  }

  history(paymentId?: string): LedgerEvent[] {
    if (paymentId === undefined) return [...this.events];
    return this.events.filter((e) => e.paymentId === paymentId);
  }

  eventsByType(type: LedgerEventType, sinceIso?: string): LedgerEvent[] {
    return this.events.filter(
      (e) => e.type === type && (sinceIso === undefined || e.at >= sinceIso),
    );
  }

  verifyIntegrity(): LedgerIntegrity {
    return checkChain(this.events, this.signer);
  }
}
