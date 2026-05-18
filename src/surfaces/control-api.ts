import { timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import type { Mandate, RailId } from "../core/types.ts";
import type { WalletDaemon } from "../core/wallet.ts";
import { CONTROL_UI_HTML } from "./control-ui.ts";
import {
  parseMoney,
  serve,
  type AuthContext,
  type HttpResult,
} from "./http-util.ts";

/**
 * Operator control plane — the human's surface for running the wallet.
 *
 * These endpoints are OPERATOR-ONLY. They create mandates (grant spending
 * authority), resolve approvals, and unfreeze the wallet — so they must never
 * be reachable by the agent. When `startControlServer` is given a token,
 * every endpoint except `GET /` requires it as an `Authorization: Bearer`
 * header or a `?token=` query parameter. The agent gets only the MCP surface
 * and the payment API, neither of which can grant authority or lift a freeze.
 *
 *   GET  /                          the control-plane web UI
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
 *   GET  /funding-source             the registered funding source
 *   POST /funding-source             register one  ({ paymentMethodId, ... })
 *   DELETE /funding-source           remove it
 */
export async function routeControlRequest(
  wallet: WalletDaemon,
  method: string,
  path: string,
  query: URLSearchParams,
  body: unknown,
): Promise<HttpResult> {
  if (method === "GET" && (path === "/" || path === "/index.html")) {
    return {
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: CONTROL_UI_HTML,
    };
  }

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

  if (method === "GET" && path === "/funding-source") {
    return { status: 200, body: fundingView(wallet) };
  }

  if (method === "POST" && path === "/funding-source") {
    const b = (body ?? {}) as Record<string, unknown>;
    if (!b["paymentMethodId"]) {
      return { status: 400, body: { error: "paymentMethodId is required" } };
    }
    wallet.registerFundingSource({
      paymentMethodId: String(b["paymentMethodId"]),
      brand: b["brand"] === undefined ? undefined : String(b["brand"]),
      last4: b["last4"] === undefined ? undefined : String(b["last4"]),
      label: b["label"] === undefined ? undefined : String(b["label"]),
      addedAt: new Date().toISOString(),
    });
    return { status: 201, body: fundingView(wallet) };
  }

  if (method === "DELETE" && path === "/funding-source") {
    wallet.clearFundingSource();
    return { status: 200, body: fundingView(wallet) };
  }

  return notFound(`route ${method} ${path}`);
}

/** The funding source as shown to the operator — the `pm_` id is not echoed. */
function fundingView(wallet: WalletDaemon): Record<string, unknown> {
  const source = wallet.fundingSource();
  if (!source) return { registered: false };
  return {
    registered: true,
    brand: source.brand,
    last4: source.last4,
    label: source.label,
    addedAt: source.addedAt,
  };
}

/**
 * Start the operator control plane.
 *
 * When `token` is given, every endpoint except `GET /` requires it. When it is
 * omitted the API is unauthenticated — intended only for tests; the
 * `control` daemon always supplies a token.
 */
export function startControlServer(
  wallet: WalletDaemon,
  port = 4023,
  token?: string,
): Server {
  return serve(
    "control API",
    (method, path, query, body) =>
      routeControlRequest(wallet, method, path, query, body),
    port,
    token ? { authorize: (ctx) => isAuthorized(ctx, token) } : {},
  );
}

/**
 * Authorise a control-API request. `GET /` (the static UI page) is always
 * allowed so a browser can load the console; every other endpoint requires
 * the bearer token, from an `Authorization: Bearer` header or `?token=`.
 */
function isAuthorized(ctx: AuthContext, token: string): boolean {
  if (ctx.method === "GET" && (ctx.path === "/" || ctx.path === "/index.html")) {
    return true;
  }
  const presented =
    bearerToken(ctx.headers["authorization"]) ?? ctx.query.get("token") ?? "";
  return constantTimeEquals(presented, token);
}

/** Extract the token from an `Authorization: Bearer <token>` header value. */
function bearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.startsWith("Bearer ") ? value.slice(7) : undefined;
}

/** Compare two strings without leaking their relationship through timing. */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
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
  if (Array.isArray(r["allowedMerchants"])) {
    mandate.allowedMerchants = r["allowedMerchants"] as string[];
  }
  if (Array.isArray(r["blockedCategories"])) {
    mandate.blockedCategories = r["blockedCategories"] as string[];
  }
  if (r["perItemCap"] !== undefined) {
    mandate.perItemCap = parseMoney(r["perItemCap"]);
  }
  if (r["expiresAt"] !== undefined) {
    mandate.expiresAt = String(r["expiresAt"]);
  }
  if (r["revoked"] !== undefined) mandate.revoked = Boolean(r["revoked"]);
  return mandate;
}
