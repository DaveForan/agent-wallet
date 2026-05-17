import type { DatabaseSync } from "node:sqlite";
import type { ApprovalStore, PendingApproval } from "../core/approvals.ts";
import { decode, encode } from "./codec.ts";

/**
 * SQLite-backed approval store — payments escalated for human approval survive
 * a restart, so a pending decision is never silently lost.
 */
export class SqliteApprovalStore implements ApprovalStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  put(approval: PendingApproval): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO pending_approvals " +
          "(approval_id, payment_id, reason, data) VALUES (?, ?, ?, ?)",
      )
      .run(
        approval.approvalId,
        approval.request.id,
        approval.reason,
        encode(approval),
      );
  }

  get(approvalId: string): PendingApproval | undefined {
    const row = this.db
      .prepare("SELECT data FROM pending_approvals WHERE approval_id = ?")
      .get(approvalId);
    return row ? decode<PendingApproval>(String(row["data"])) : undefined;
  }

  list(): PendingApproval[] {
    return this.db
      .prepare("SELECT data FROM pending_approvals ORDER BY approval_id")
      .all()
      .map((row) => decode<PendingApproval>(String(row["data"])));
  }

  remove(approvalId: string): void {
    this.db
      .prepare("DELETE FROM pending_approvals WHERE approval_id = ?")
      .run(approvalId);
  }
}
