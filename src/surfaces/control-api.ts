import type { Server } from "node:http";
import type { Mandate, RailId } from "../core/types.ts";
import type { WalletDaemon } from "../core/wallet.ts";
import { parseMoney, serve, type HttpResult } from "./http-util.ts";

/**
 * Operator control plane — the human's surface for running the wallet.
 *
 * These endpoints are OPERATOR-ONLY. They create mandates (grant spending
 * authority), resolve approvals, and unfreeze the wallet — so they must never
 * be reachable by the agent. Bind this server to localhost, and in a real
 * deployment put authentication in front of it. The agent gets only the MCP
 * surface and the payment API, neither of which can grant authority or lift a
 * freeze.
 *
 *   GET  /status                    freeze state + queue sizes
 *   GET  /report                    spend summary from the ledger
 *   GET  /audit?paymentId=...        raw audit ledger
 *   GET  /mandates                   list mandates
 *   POST /mandates                   create a mandate
 *   GET  /mandates/:id               fetch one mandate
 *   POST /mandates/:id/revoke        revoke a mandate
 *   GET  /approvals                  list payments awaiting approval
 *   POST /approvals/:id/resolve      approve / reject  ({ approved: bool })
 *   POST /freeze                     freeze the wallet  ({ reason })
 *   POST /unfreeze                   lift the freeze
 */
export async function routeControlRequest(
  wallet: WalletDaemon,
  method: string,
  path: string,
  query: URLSearchParams,
  body: unknown,
): Promise<HttpResult> {
  if (method === "GET" && path === "/status") {
    return {
      status: 200,
      body: {
        ...wallet.controlStatus(),
        pendingApprovals: wallet.listPendingApprovals().length,
        mandates: wallet.listMandates().length,
      },
    };
  }

  if (method === "GET" && path === "/report") {
    return { status: 200, body: wallet.report() };
  }

  if (method === "GET" && path === "/audit") {
    return {
      status: 200,
      body: wallet.audit(query.get("paymentId") ?? undefined),
    };
  }

  if (method === "GET" && path === "/mandates") {
    return { status: 200, body: wallet.listMandates() };
  }

  if (method === "POST" && path === "/mandates") {
    const mandate = parseMandate(body);
    wallet.createMandate(mandate);
    return { status: 201, body: mandate };
  }

  const mandateById = /^\/mandates\/([^/]+)$/.exec(path);
  if (method === "GET" && mandateById) {
    const mandate = wallet
      .listMandates()
      .find((m) => m.id === mandateById[1]);
    return mandate
      ? { status: 200, body: mandate }
      : notFound(`mandate ${mandateById[1]}`);
  }

  const mandateRevoke = /^\/mandates\/([^/]+)\/revoke$/.exec(path);
  if (method === "POST" && mandateRevoke) {
    return wallet.revokeMandate(mandateRevoke[1])
      ? { status: 200, body: { revoked: mandateRevoke[1] } }
      : notFound(`mandate ${mandateRevoke[1]}`);
  }

  if (method === "GET" && path === "/approvals") {
    return { status: 200, body: wallet.listPendingApprovals() };
  }

  const approvalResolve = /^\/approvals\/([^/]+)\/resolve$/.exec(path);
  if (method === "POST" && approvalResolve) {
    const approved = Boolean((body as { approved?: unknown })?.approved);
    return {
      status: 200,
      body: await wallet.resolveApproval(approvalResolve[1], approved),
    };
  }

  if (method === "POST" && path === "/freeze") {
    const reason = String(
      (body as { reason?: unknown })?.reason ?? "frozen by operator",
    );
    wallet.freeze(reason);
    return { status: 200, body: wallet.controlStatus() };
  }

  if (method === "POST" && path === "/unfreeze") {
    wallet.unfreeze();
    return { status: 200, body: wallet.controlStatus() };
  }

  return notFound(`route ${method} ${path}`);
}

/** Start the operator control plane. */
export function startControlServer(
  wallet: WalletDaemon,
  port = 4023,
): Server {
  return serve(
    "control API",
    (method, path, query, body) =>
      routeControlRequest(wallet, method, path, query, body),
    port,
  );
}

function notFound(what: string): HttpResult {
  return { status: 404, body: { error: `not found: ${what}` } };
}

/**
 * Parse an untrusted JSON body into a Mandate, restoring the bigint amounts
 * that JSON cannot carry. Operator input is validated by the policy engine
 * when payments are drawn against the mandate.
 */
function parseMandate(raw: unknown): Mandate {
  const r = (raw ?? {}) as Record<string, unknown>;
  const mandate: Mandate = {
    id: String(r["id"]),
    grantedBy: String(r["grantedBy"]),
    cap: parseMoney(r["cap"]),
  };
  if (r["perTxnCap"] !== undefined) {
    mandate.perTxnCap = parseMoney(r["perTxnCap"]);
  }
  if (r["window"] !== undefined) {
    const window = r["window"] as { cap?: unknown; durationMs?: unknown };
    mandate.window = {
      cap: parseMoney(window.cap),
      durationMs: Number(window.durationMs),
    };
  }
  if (Array.isArray(r["rails"])) mandate.rails = r["rails"] as RailId[];
  if (Array.isArray(r["allowedPayees"])) {
    mandate.allowedPayees = r["allowedPayees"] as string[];
  }
  if (Array.isArray(r["allowedCategories"])) {
    mandate.allowedCategories = r["allowedCategories"] as string[];
  }
  if (r["expiresAt"] !== undefined) {
    mandate.expiresAt = String(r["expiresAt"]);
  }
  if (r["revoked"] !== undefined) mandate.revoked = Boolean(r["revoked"]);
  return mandate;
}
