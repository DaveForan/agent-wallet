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
import type { PaymentRail } from "./rails/rail.ts";
import { openWalletDatabase } from "./storage/db.ts";
import { SqliteApprovalStore } from "./storage/sqlite-approval-store.ts";
import { SqliteControlState } from "./storage/sqlite-control-state.ts";
import { SqliteFundingSourceStore } from "./storage/sqlite-funding-store.ts";
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

/** Custody is not exercised here — the test rail settles without signing. */
const custody: CustodyProvider = {
  kind: "local",
  account: () => Promise.reject(new Error("custody unused in this test")),
  authorize: () => Promise.reject(new Error("custody unused in this test")),
};

/** A rail that always settles, for exercising spend accounting deterministically. */
const settlingRail: PaymentRail = {
  id: "x402",
  supports: () => true,
  quote: (req) =>
    Promise.resolve({
      total: req.amount,
      fee: { amount: 0n, currency: req.amount.currency },
      quoteRef: "test",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  settle: (req) =>
    Promise.resolve({
      settled: true,
      reference: "test-settlement",
      settledAmount: req.amount,
      order: { id: `ord-${req.id}`, sessionId: "sess-test" },
    }),
};

/** Build a daemon backed entirely by the SQLite stores on `db`. */
function buildWallet(db: DatabaseSync): WalletDaemon {
  return new WalletDaemon({
    policy: { mode: "tiered", autoApproveThreshold: money(100, "USD") },
    rails: [settlingRail],
    custody,
    ledger: new SqliteLedger(db),
    mandates: new SqliteMandateStore(db),
    approvals: new SqliteApprovalStore(db),
    control: new SqliteControlState(db),
    funding: new SqliteFundingSourceStore(db),
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

  // Two sub-threshold payments settle and accumulate against a mandate's cap.
  walletA.createMandate({
    id: "spend-mandate",
    grantedBy: "dave",
    cap: money(500, "USD"),
    rails: ["x402"],
  });
  for (let i = 0; i < 2; i++) {
    const settled = await walletA.pay({
      rail: "x402",
      amount: money(50, "USD"), // $0.50 — under the $1.00 auto-approve line
      payee: { address: "https://api.example.com" },
      mandateId: "spend-mandate",
    });
    check(`sub-threshold payment ${i + 1} settles`, settled.status === "settled");
  }
  const spendBefore = walletA
    .report()
    .mandates.find((m) => m.id === "spend-mandate");
  check(
    "settled payments accumulate against the mandate",
    spendBefore?.spent === "100",
  );

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
  check(
    "accumulated mandate spend survived the restart",
    walletB.report().mandates.find((m) => m.id === "spend-mandate")?.spent ===
      "100",
  );

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
      "GET /status: frozen, 2 mandates, 1 approval",
      status.frozen === true &&
        status.mandates === 2 &&
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
      perItemCap: { amount: "2000", currency: "USD" },
      rails: ["stripe", "acp"],
      blockedCategories: ["alcohol"],
      allowedMerchantDomains: ["shop.realgrocer.com"],
    });
    check("POST /mandates creates a mandate", created.id === "http-mandate");
    check(
      "the mandate's shopping rules round-trip",
      Array.isArray(created.blockedCategories) &&
        created.blockedCategories[0] === "alcohol" &&
        created.allowedMerchantDomains?.[0] === "shop.realgrocer.com" &&
        created.perItemCap?.amount === "2000",
    );

    const mandates = (await api("GET", "/mandates")) as unknown[];
    check("GET /mandates lists all three mandates", mandates.length === 3);

    const report = await api("GET", "/report");
    check(
      "GET /report summarises spend and mandates",
      typeof report.generatedAt === "string" &&
        Array.isArray(report.mandates) &&
        report.mandates.length === 3,
    );
    check(
      "GET /report reconciles settled payments to merchant orders",
      Array.isArray(report.orders) && report.orders.length === 2,
    );

    const uiRes = await fetch(`http://localhost:${PORT}/`);
    const uiHtml = await uiRes.text();
    check(
      "GET / serves the control-plane web UI",
      (uiRes.headers.get("content-type") ?? "").includes("text/html") &&
        uiHtml.includes("agent-wallet") &&
        uiHtml.includes("Approval queue"),
    );

    const noFunding = await api("GET", "/funding-source");
    check("a fresh wallet has no funding source", noFunding.registered === false);

    const registered = await api("POST", "/funding-source", {
      paymentMethodId: "pm_test_123",
      brand: "visa",
      last4: "4242",
      label: "test card",
    });
    check(
      "POST /funding-source registers a funding source",
      registered.registered === true && registered.last4 === "4242",
    );
    check(
      "the funding-source view does not echo the payment method id",
      registered["paymentMethodId"] === undefined,
    );

    const cleared = await api("DELETE", "/funding-source");
    check("DELETE /funding-source removes it", cleared.registered === false);

    const agent = await api("POST", "/agents", {
      id: "research-agent",
      label: "Research",
    });
    check(
      "POST /agents registers an agent and returns a one-time token",
      typeof agent["token"] === "string" &&
        String(agent["token"]).startsWith("awk_"),
    );
    const agentList = (await api("GET", "/agents")) as { id: string }[];
    check(
      "GET /agents lists the agent without its token",
      agentList.some((a) => a.id === "research-agent"),
    );
    const revoked = await api("DELETE", "/agents/research-agent");
    check("DELETE /agents/:id revokes the agent", revoked["revoked"] === true);

    console.log("\nfinal report:");
    console.log(
      JSON.stringify(report, null, 2)
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    );

    // --- Phase 3: bearer-token authentication on the control API.
    console.log("\nphase 3: control-API authentication");
    const token = "smoke-test-token";
    const authBase = `http://localhost:${PORT + 1}`;
    const authServer = startControlServer(walletB, PORT + 1, token);
    if (!authServer.listening) await once(authServer, "listening");
    try {
      const noToken = await fetch(`${authBase}/status`);
      check("a request with no token is rejected 401", noToken.status === 401);

      const wrongToken = await fetch(`${authBase}/status`, {
        headers: { authorization: "Bearer wrong" },
      });
      check("a wrong token is rejected 401", wrongToken.status === 401);

      const headerAuth = await fetch(`${authBase}/status`, {
        headers: { authorization: `Bearer ${token}` },
      });
      check("the right token is accepted", headerAuth.status === 200);

      const queryAuth = await fetch(`${authBase}/status?token=${token}`);
      check("the token also works as a ?token= query param", queryAuth.status === 200);

      const uiOpen = await fetch(`${authBase}/`);
      check("GET / serves the UI without a token", uiOpen.status === 200);
    } finally {
      authServer.close();
    }
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
