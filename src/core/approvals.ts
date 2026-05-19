import type { PaymentRequest } from "./types.ts";

/** A payment the policy engine escalated, awaiting a human decision. */
export interface PendingApproval {
  approvalId: string;
  request: PaymentRequest;
  /** Why the policy engine escalated this payment. */
  reason: string;
  /**
   * Set by the daemon when an approval timeout is configured. Past this point
   * the approval is auto-expired and the payment is blocked, so the queue
   * does not accumulate indefinitely.
   */
  expiresAt?: string;
}

/**
 * Storage for payments awaiting human approval.
 *
 * Persisting these matters: an escalated payment that vanished when the
 * daemon restarted would be silently dropped — the human would never get to
 * decide, and the agent would never learn the outcome.
 */
export interface ApprovalStore {
  put(approval: PendingApproval): void;
  get(approvalId: string): PendingApproval | undefined;
  list(): PendingApproval[];
  remove(approvalId: string): void;
}

/** Development approval store. Pending approvals are lost on restart. */
export class InMemoryApprovalStore implements ApprovalStore {
  private readonly approvals = new Map<string, PendingApproval>();

  put(approval: PendingApproval): void {
    this.approvals.set(approval.approvalId, approval);
  }

  get(approvalId: string): PendingApproval | undefined {
    return this.approvals.get(approvalId);
  }

  list(): PendingApproval[] {
    return [...this.approvals.values()];
  }

  remove(approvalId: string): void {
    this.approvals.delete(approvalId);
  }
}
