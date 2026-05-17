/**
 * Smoke test for durable storage and the operator control plane:
 * `npm run control:check`.
 *
 * It proves two things:
 *  1. State survives a restart — a mandate, a pending approval and a freeze
 *     written by one daemon instance are seen by a fresh instance opened on
 *     the same SQLite file.
 *  2. The operator HTTP control plane works end to end, including that a
 *     frozen wallet refuses to settle even an approved payment.
 */

import { once } from "node:events";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { money, type Mandate } from "./core/types.ts";
import { WalletDaemon } from "./core/wallet.ts";
import type { CustodyProvider } from "./custody/custody.ts";
import { openWalletDatabase } from "./storage/db.ts";
import { SqliteApprovalStore } from "./storage/sqlite-approval-store.ts";
import { SqliteControlState } from "./storage/sqlite-control-state.ts";
import { SqliteLedger } from "./storage/sqlite-ledger.ts";
import { SqliteMandateStore } from "./storage/sqlite-mandate-store.ts";
import { startControlServer } from "./surfaces/control-api.ts";

const DB_PATH = join(tmpdir(), `agent-wallet-control-${Date.now()}.db`);
const PORT = 4099;

let passed = 0;
function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`  ok  ${label}`);
  passed++;
}

/** Custody is never exercised here — no payment in this test settles. */
const custody: CustodyProvider = {
  kind: "local",
  account: () => Promise.reject(new Error("custody unused in this test")),
  authorize: () => Promise.reject(new Error("custody unused in this test")),
};

/** Build a daemon backed entirely by the SQLite stores on `db`. */
function buildWallet(db: DatabaseSync): WalletDaemon {
  return new WalletDaemon({
    policy: { mode: "tiered", autoApproveThreshold: money(100, "USD") },
    rails: [],
    custody,
    ledger: new SqliteLedger(db),
    mandates: new SqliteMandateStore(db),
    approvals: new SqliteApprovalStore(db),
    control: new SqliteControlState(db),
  });
}

const sampleMandate: Mandate = {
  id: "ops-mandate",
  grantedBy: "dave",
  cap: money(100_000, "USD"),
  rails: ["x402", "stripe"],
};

async function main(): Promise<void> {
  // --- Phase 1: write state with instance A, then "restart" into instance B.
  console.log("phase 1: durable storage across a restart");
  const dbA = openWalletDatabase(DB_PATH);
  const walletA = buildWallet(dbA);
  walletA.createMandate(sampleMandate);
  const escalated = await walletA.pay({
    rail: "x402",
    amount: money(500, "USD"), // $5.00 — over the $1.00 auto-approve threshold
    payee: { address: "https://api.example.com", label: "Example API" },
    memo: "control-plane smoke test",
  });
  check(
    "a $5 payment escalates for approval",
    escalated.status === "pending_approval",
  );
  walletA.freeze("smoke test freeze");
  check("wallet A reports frozen", walletA.controlStatus().frozen);
  dbA.close();

  // Reopen the same database file with a brand-new daemon instance.
  const dbB = openWalletDatabase(DB_PATH);
  const walletB = buildWallet(dbB);
  check(
    "mandate survived the restart",
    walletB.listMandates().some((m) => m.id === sampleMandate.id),
  );
  check(
    "pending approval survived the restart",
    walletB.listPendingApprovals().length === 1,
  );
  check("freeze survived the restart", walletB.controlStatus().frozen);
  check("audit ledger survived the restart", walletB.audit().length > 0);

  // --- Phase 2: drive the operator control plane over HTTP.
  console.log("\nphase 2: operator HTTP control plane");
  const server = startControlServer(walletB, PORT);
  if (!server.listening) await once(server, "listening");

  /** Call the control API and return the parsed JSON response. */
  async function api(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<any> {
    const res = await fetch(`http://localhost:${PORT}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }

  try {
    const status = await api("GET", "/status");
    check(
      "GET /status: frozen, 1 mandate, 1 approval",
      status.frozen === true &&
        status.mandates === 1 &&
        status.pendingApprovals === 1,
    );

    const approvals = (await api("GET", "/approvals")) as {
      approvalId: string;
    }[];
    check("GET /approvals lists the pending payment", approvals.length === 1);

    // Resolving an approval while the wallet is frozen must NOT settle.
    const blocked = await api(
      "POST",
      `/approvals/${approvals[0].approvalId}/resolve`,
      { approved: true },
    );
    check(
      "a frozen wallet blocks an approved payment",
      blocked.status === "denied" && /frozen/.test(String(blocked.reason)),
    );

    const unfrozen = await api("POST", "/unfreeze");
    check("POST /unfreeze clears the freeze", unfrozen.frozen === false);

    const created = await api("POST", "/mandates", {
      id: "http-mandate",
      grantedBy: "dave",
      cap: { amount: "25000", currency: "USD" },
      perTxnCap: { amount: "5000", currency: "USD" },
      rails: ["stripe"],
    });
    check("POST /mandates creates a mandate", created.id === "http-mandate");

    const mandates = (await api("GET", "/mandates")) as unknown[];
    check("GET /mandates lists both mandates", mandates.length === 2);

    const report = await api("GET", "/report");
    check(
      "GET /report summarises spend and mandates",
      typeof report.generatedAt === "string" &&
        Array.isArray(report.mandates) &&
        report.mandates.length === 2,
    );

    const uiRes = await fetch(`http://localhost:${PORT}/`);
    const uiHtml = await uiRes.text();
    check(
      "GET / serves the control-plane web UI",
      (uiRes.headers.get("content-type") ?? "").includes("text/html") &&
        uiHtml.includes("agent-wallet") &&
        uiHtml.includes("Approval queue"),
    );

    console.log("\nfinal report:");
    console.log(
      JSON.stringify(report, null, 2)
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    );
  } finally {
    server.close();
    dbB.close();
  }

  console.log(`\nAll ${passed} checks passed.`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Drop the temp database and its WAL sidecar files.
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(DB_PATH + suffix, { force: true });
    }
  });
