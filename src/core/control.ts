/** The wallet's freeze (kill-switch) state. */
export interface FreezeStatus {
  frozen: boolean;
  /** Why the wallet was frozen — present while it is. */
  reason?: string;
  /** ISO-8601 timestamp of the last freeze or unfreeze. */
  changedAt?: string;
}

/**
 * The wallet's operator-controlled state.
 *
 * The freeze is a kill-switch: while the wallet is frozen, every payment is
 * rejected regardless of policy or mandate — the operator's instant stop if an
 * agent misbehaves. It is deliberately separate from policy: policy reasons
 * about individual payments, the freeze is an absolute gate above all of them.
 */
export interface ControlState {
  status(): FreezeStatus;
  freeze(reason: string): void;
  unfreeze(): void;
}

/** Development control state. The freeze flag is lost on restart. */
export class InMemoryControlState implements ControlState {
  private frozen = false;
  private reason: string | undefined;
  private changedAt: string | undefined;

  status(): FreezeStatus {
    return {
      frozen: this.frozen,
      reason: this.reason,
      changedAt: this.changedAt,
    };
  }

  freeze(reason: string): void {
    this.frozen = true;
    this.reason = reason;
    this.changedAt = new Date().toISOString();
  }

  unfreeze(): void {
    this.frozen = false;
    this.reason = undefined;
    this.changedAt = new Date().toISOString();
  }
}
