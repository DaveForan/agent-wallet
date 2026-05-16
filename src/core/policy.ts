import {
  addMoney,
  compareMoney,
  formatMoney,
  type Mandate,
  type Money,
  type PaymentRequest,
  type PolicyConfig,
  type PolicyDecision,
} from "./types.ts";

/**
 * Context the policy engine needs beyond the request itself. The WalletDaemon
 * assembles this from the mandate store and the ledger, keeping the engine a
 * pure, testable function of (config, request, context).
 */
export interface PolicyContext {
  /** The mandate named by the request, already resolved (if any). */
  mandate?: Mandate;
  /** Total already settled against that mandate, in the mandate's currency. */
  spentAgainstMandate?: Money;
  /** Total settled within the mandate's rolling window, if it has one. */
  spentInWindow?: Money;
}

/**
 * The policy engine is the wallet's trust boundary. The agent proposes a
 * payment; this decides allow / deny / needs_approval. It never moves money.
 */
export class PolicyEngine {
  private readonly config: PolicyConfig;

  constructor(config: PolicyConfig) {
    this.config = config;
  }

  evaluate(req: PaymentRequest, ctx: PolicyContext): PolicyDecision {
    // 1. Absolute ceiling — overrides everything, including mandates.
    const { hardLimit } = this.config;
    if (hardLimit) {
      const cmp = compareMoney(req.amount, hardLimit);
      if (cmp === undefined) {
        return needsApproval(
          `amount ${formatMoney(req.amount)} cannot be compared to the ` +
            `hard limit (${formatMoney(hardLimit)}) — different currency`,
        );
      }
      if (cmp > 0) {
        return deny(
          `amount ${formatMoney(req.amount)} exceeds hard limit ` +
            formatMoney(hardLimit),
        );
      }
    }

    // 2. Mandate checks — a mandate is a hard grant; violations are denials.
    const { mandate } = ctx;
    if (mandate) {
      const violated = this.checkMandate(req, ctx, mandate);
      if (violated) return violated;
    } else if (this.config.requireMandate) {
      return needsApproval("no mandate supplied and requireMandate is set");
    }

    // 3. Autonomy mode decides allow vs. human approval for permitted spend.
    return this.applyAutonomy(req);
  }

  /** Returns a denial only if the mandate is violated; otherwise undefined. */
  private checkMandate(
    req: PaymentRequest,
    ctx: PolicyContext,
    mandate: Mandate,
  ): PolicyDecision | undefined {
    if (mandate.revoked) return deny(`mandate ${mandate.id} is revoked`);

    if (mandate.expiresAt && Date.parse(mandate.expiresAt) < Date.now()) {
      return deny(`mandate ${mandate.id} expired at ${mandate.expiresAt}`);
    }

    if (mandate.rails?.length && !mandate.rails.includes(req.rail)) {
      return deny(`mandate ${mandate.id} does not permit the ${req.rail} rail`);
    }

    if (
      mandate.allowedPayees?.length &&
      !mandate.allowedPayees.includes(req.payee.address)
    ) {
      return deny(`payee ${req.payee.address} is not on the mandate allowlist`);
    }

    if (
      mandate.allowedCategories?.length &&
      (!req.payee.category ||
        !mandate.allowedCategories.includes(req.payee.category))
    ) {
      return deny(
        `payee category "${req.payee.category ?? "unknown"}" is not permitted`,
      );
    }

    if (mandate.perTxnCap) {
      const cmp = compareMoney(req.amount, mandate.perTxnCap);
      if (cmp === undefined || cmp > 0) {
        return deny(
          `amount ${formatMoney(req.amount)} exceeds the per-transaction ` +
            `cap of ${formatMoney(mandate.perTxnCap)}`,
        );
      }
    }

    const overCap = exceedsCap(req.amount, ctx.spentAgainstMandate, mandate.cap);
    if (overCap) return deny(overCap);

    if (mandate.window) {
      const overWindow = exceedsCap(
        req.amount,
        ctx.spentInWindow,
        mandate.window.cap,
      );
      if (overWindow) return deny(`rolling-window limit reached: ${overWindow}`);
    }

    return undefined;
  }

  private applyAutonomy(req: PaymentRequest): PolicyDecision {
    switch (this.config.mode) {
      case "autonomous":
        return allow("within mandate; autonomous mode");

      case "approve-every":
        return needsApproval("approve-every mode requires human sign-off");

      case "tiered": {
        const threshold = this.config.autoApproveThreshold;
        if (!threshold) {
          return needsApproval(
            "tiered mode has no autoApproveThreshold configured",
          );
        }
        const cmp = compareMoney(req.amount, threshold);
        if (cmp === undefined) {
          return needsApproval(
            `amount ${formatMoney(req.amount)} is a different currency ` +
              `than the auto-approve threshold`,
          );
        }
        return cmp <= 0
          ? allow(
              `${formatMoney(req.amount)} is at or under the auto-approve ` +
                `threshold of ${formatMoney(threshold)}`,
            )
          : needsApproval(
              `${formatMoney(req.amount)} exceeds the auto-approve ` +
                `threshold of ${formatMoney(threshold)}`,
            );
      }
    }
  }
}

/** Returns an explanatory string if amount + alreadySpent would exceed cap. */
function exceedsCap(
  amount: Money,
  alreadySpent: Money | undefined,
  cap: Money,
): string | undefined {
  const spent = alreadySpent ?? { amount: 0n, currency: cap.currency };
  if (spent.currency !== cap.currency || amount.currency !== cap.currency) {
    return `currency mismatch while checking the ${formatMoney(cap)} cap`;
  }
  const projected = addMoney(spent, amount);
  return compareMoney(projected, cap) === 1
    ? `${formatMoney(projected)} would exceed the cap of ${formatMoney(cap)}`
    : undefined;
}

const allow = (reason: string): PolicyDecision => ({ outcome: "allow", reason });
const deny = (reason: string): PolicyDecision => ({ outcome: "deny", reason });
const needsApproval = (reason: string): PolicyDecision => ({
  outcome: "needs_approval",
  reason,
});
