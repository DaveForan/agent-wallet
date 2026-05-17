import { randomUUID } from "node:crypto";
import type { CustodyProvider } from "../custody/custody.ts";
import type { PaymentRail, SettlementResult } from "../rails/rail.ts";
import {
  InMemoryApprovalStore,
  type ApprovalStore,
  type PendingApproval,
} from "./approvals.ts";
import {
  InMemoryControlState,
  type ControlState,
  type FreezeStatus,
} from "./control.ts";
import { NotImplementedError, WalletError } from "./errors.ts";
import { InMemoryLedger, type Ledger } from "./ledger.ts";
import { InMemoryMandateStore, type MandateStore } from "./mandates.ts";
import { PolicyEngine, type PolicyContext } from "./policy.ts";
import {
  addMoney,
  type Mandate,
  type Money,
  type PaymentChannel,
  type PaymentRequest,
  type PolicyConfig,
  type PolicyDecision,
  type RailId,
} from "./types.ts";

export interface WalletConfig {
  /** Policy engine configuration — sets the autonomy posture. */
  policy: PolicyConfig;
  /** Every rail the wallet may use. */
  rails: PaymentRail[];
  /** Where keys and funds live. */
  custody: CustodyProvider;
  /** Audit ledger. Defaults to an in-memory ledger. */
  ledger?: Ledger;
  /** Mandate store. Defaults to an in-memory store. */
  mandates?: MandateStore;
  /** Pending-approval store. Defaults to an in-memory store. */
  approvals?: ApprovalStore;
  /** Freeze / kill-switch state. Defaults to in-memory. */
  control?: ControlState;
}

/** What an agent supplies to ask for a payment; `id`/`createdAt` are filled in. */
export type PaymentInput = Omit<
  PaymentRequest,
  "id" | "createdAt" | "channel"
> & { channel?: PaymentChannel };

/** The outcome of a `pay()` call. */
export type PayResult =
  | { status: "settled"; paymentId: string; settlement: SettlementResult }
  | { status: "denied"; paymentId: string; reason: string }
  | { status: "failed"; paymentId: string; reason: string }
  | {
      status: "pending_approval";
      paymentId: string;
      approvalId: string;
      reason: string;
    };

/** An operator spend summary, computed from the audit ledger. */
export interface SpendReport {
  generatedAt: string;
  payments: { settled: number; failed: number; denied: number; blocked: number };
  /** Total settled per currency, as bigint-safe strings. */
  settledByCurrency: Record<string, string>;
  pendingApprovals: number;
  mandates: {
    id: string;
    currency: string;
    cap: string;
    spent: string;
    revoked: boolean;
  }[];
}

/** Derive a human-readable reason from a rail's unsettled SettlementResult. */
function settlementFailureReason(settlement: SettlementResult): string {
  const raw = settlement.raw as
    | { error?: string; errorMessage?: string; errorReason?: string }
    | undefined;
  return (
    raw?.error ??
    raw?.errorMessage ??
    raw?.errorReason ??
    "the rail did not complete settlement"
  );
}

/**
 * The WalletDaemon is the trust boundary between an (untrusted) agent and real
 * money. Agents call `pay()`; the daemon runs policy, records everything to
 * the ledger, and only then asks a rail to settle.
 */
export class WalletDaemon {
  private readonly policy: PolicyEngine;
  private readonly rails = new Map<RailId, PaymentRail>();
  private readonly custody: CustodyProvider;
  private readonly ledger: Ledger;
  private readonly mandates: MandateStore;
  private readonly approvals: ApprovalStore;
  private readonly control: ControlState;

  constructor(config: WalletConfig) {
    this.policy = new PolicyEngine(config.policy);
    for (const rail of config.rails) this.rails.set(rail.id, rail);
    this.custody = config.custody;
    this.ledger = config.ledger ?? new InMemoryLedger();
    this.mandates = config.mandates ?? new InMemoryMandateStore();
    this.approvals = config.approvals ?? new InMemoryApprovalStore();
    this.control = config.control ?? new InMemoryControlState();
  }

  /** Freeze the wallet — every payment is rejected until it is unfrozen. */
  freeze(reason: string): void {
    this.control.freeze(reason);
    this.ledger.append("wallet.frozen", { reason });
  }

  /** Lift a freeze, allowing payments to resume. */
  unfreeze(): void {
    this.control.unfreeze();
    this.ledger.append("wallet.unfrozen", {});
  }

  /** The current freeze state. */
  controlStatus(): FreezeStatus {
    return this.control.status();
  }

  /** Register a mandate (a grant of spending authority). */
  createMandate(mandate: Mandate): void {
    this.mandates.put(mandate);
    this.ledger.append("mandate.created", { mandate });
  }

  /** Revoke a mandate; payments drawn against it are denied from now on. */
  revokeMandate(id: string): boolean {
    const ok = this.mandates.revoke(id);
    if (ok) this.ledger.append("mandate.revoked", { mandateId: id });
    return ok;
  }

  /** All mandates currently registered. */
  listMandates(): Mandate[] {
    return this.mandates.list();
  }

  /** Read the audit ledger — all events, or one payment's trail. */
  audit(paymentId?: string) {
    return this.ledger.history(paymentId);
  }

  /** A spend summary for the operator, computed from the audit ledger. */
  report(): SpendReport {
    const payments = { settled: 0, failed: 0, denied: 0, blocked: 0 };
    const settled = new Map<string, bigint>();
    for (const event of this.ledger.history()) {
      switch (event.type) {
        case "payment.settled": {
          payments.settled++;
          const result = event.data["settlement"] as
            | SettlementResult
            | undefined;
          if (result?.settled) {
            const { currency, amount } = result.settledAmount;
            settled.set(currency, (settled.get(currency) ?? 0n) + amount);
          }
          break;
        }
        case "payment.failed":
          payments.failed++;
          break;
        case "payment.blocked":
          payments.blocked++;
          break;
        case "policy.decided": {
          const decision = event.data["decision"] as
            | PolicyDecision
            | undefined;
          if (decision?.outcome === "deny") payments.denied++;
          break;
        }
        default:
          break;
      }
    }
    const settledByCurrency: Record<string, string> = {};
    for (const [currency, amount] of settled) {
      settledByCurrency[currency] = amount.toString();
    }
    return {
      generatedAt: new Date().toISOString(),
      payments,
      settledByCurrency,
      pendingApprovals: this.approvals.list().length,
      mandates: this.mandates.list().map((mandate) => ({
        id: mandate.id,
        currency: mandate.cap.currency,
        cap: mandate.cap.amount.toString(),
        spent: this.spentAgainstMandate(mandate, undefined).amount.toString(),
        revoked: mandate.revoked === true,
      })),
    };
  }

  /** Payments still awaiting a human decision. */
  listPendingApprovals(): PendingApproval[] {
    return this.approvals.list();
  }

  /**
   * The single entry point an agent uses to spend. Returns a settled result,
   * a denial, a failure, or a pending-approval handle.
   */
  async pay(input: PaymentInput): Promise<PayResult> {
    const request: PaymentRequest = {
      ...input,
      id: randomUUID(),
      channel: input.channel ?? "deliberate",
      createdAt: new Date().toISOString(),
    };
    this.ledger.append("payment.requested", { request }, request.id);

    // The freeze is an absolute gate above policy: a frozen wallet pays nobody.
    const frozen = this.frozenReason();
    if (frozen) {
      this.ledger.append("payment.blocked", { reason: frozen }, request.id);
      return { status: "denied", paymentId: request.id, reason: frozen };
    }

    const decision = this.policy.evaluate(request, this.contextFor(request));
    this.ledger.append("policy.decided", { decision }, request.id);

    if (decision.outcome === "deny") {
      return { status: "denied", paymentId: request.id, reason: decision.reason };
    }

    if (decision.outcome === "needs_approval") {
      const approvalId = randomUUID();
      this.approvals.put({ approvalId, request, reason: decision.reason });
      this.ledger.append(
        "approval.requested",
        { approvalId, reason: decision.reason },
        request.id,
      );
      return {
        status: "pending_approval",
        paymentId: request.id,
        approvalId,
        reason: decision.reason,
      };
    }

    return this.settle(request);
  }

  /** Resolve a pending approval. Approving it triggers settlement. */
  async resolveApproval(
    approvalId: string,
    approved: boolean,
  ): Promise<PayResult> {
    const pending = this.approvals.get(approvalId);
    if (!pending) throw new WalletError(`unknown approval ${approvalId}`);
    this.approvals.remove(approvalId);
    this.ledger.append(
      "approval.resolved",
      { approvalId, approved },
      pending.request.id,
    );
    if (!approved) {
      return {
        status: "denied",
        paymentId: pending.request.id,
        reason: "approval rejected by human reviewer",
      };
    }
    // A freeze applied while the approval was pending still blocks settlement.
    const frozen = this.frozenReason();
    if (frozen) {
      this.ledger.append("payment.blocked", { reason: frozen }, pending.request.id);
      return { status: "denied", paymentId: pending.request.id, reason: frozen };
    }
    return this.settle(pending.request);
  }

  private async settle(request: PaymentRequest): Promise<PayResult> {
    const rail = this.rails.get(request.rail);
    if (!rail) {
      const reason = `no rail registered for "${request.rail}"`;
      this.ledger.append("payment.failed", { reason }, request.id);
      return { status: "failed", paymentId: request.id, reason };
    }
    try {
      const quote = await rail.quote(request);
      const settlement = await rail.settle(request, quote, this.custody);
      if (!settlement.settled) {
        const reason = settlementFailureReason(settlement);
        this.ledger.append("payment.failed", { settlement }, request.id);
        return { status: "failed", paymentId: request.id, reason };
      }
      this.ledger.append("payment.settled", { settlement }, request.id);
      return { status: "settled", paymentId: request.id, settlement };
    } catch (err) {
      const reason =
        err instanceof NotImplementedError
          ? `${request.rail} rail is stubbed: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      this.ledger.append("payment.failed", { reason }, request.id);
      return { status: "failed", paymentId: request.id, reason };
    }
  }

  /** The rejection reason if the wallet is frozen, otherwise undefined. */
  private frozenReason(): string | undefined {
    const freeze = this.control.status();
    if (!freeze.frozen) return undefined;
    return `wallet is frozen${freeze.reason ? `: ${freeze.reason}` : ""}`;
  }

  /** Assemble policy context: the mandate plus spend already on the ledger. */
  private contextFor(request: PaymentRequest): PolicyContext {
    const ctx: PolicyContext = {};
    if (!request.mandateId) return ctx;

    const mandate = this.mandates.get(request.mandateId);
    if (!mandate) return ctx;

    ctx.mandate = mandate;
    ctx.spentAgainstMandate = this.spentAgainstMandate(mandate, undefined);
    if (mandate.window) {
      const since = Date.now() - mandate.window.durationMs;
      ctx.spentInWindow = this.spentAgainstMandate(mandate, since);
    }
    return ctx;
  }

  /** Sum settled payments drawn on a mandate, optionally since a timestamp. */
  private spentAgainstMandate(
    mandate: Mandate,
    sinceMs: number | undefined,
  ): Money {
    let total: Money = { amount: 0n, currency: mandate.cap.currency };
    for (const event of this.ledger.history()) {
      if (event.type !== "payment.settled") continue;
      if (sinceMs !== undefined && Date.parse(event.at) < sinceMs) continue;

      const settlement = event.data["settlement"] as SettlementResult | undefined;
      if (!settlement?.settled) continue;

      // Only count payments whose original request named this mandate.
      const trail = this.ledger.history(event.paymentId);
      const requested = trail.find((e) => e.type === "payment.requested");
      const req = requested?.data["request"] as PaymentRequest | undefined;
      if (req?.mandateId !== mandate.id) continue;
      if (settlement.settledAmount.currency !== total.currency) continue;

      total = addMoney(total, settlement.settledAmount);
    }
    return total;
  }
}
