import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { bigintReplacer } from "../core/types.ts";
import type { PaymentInput, WalletDaemon } from "../core/wallet.ts";

/**
 * Local HTTP surface — for non-MCP agents and the human approval UI.
 *
 *   POST /pay                       request a payment
 *   POST /approvals/:id/resolve     human approves/rejects a pending payment
 *   GET  /approvals                 list pending approvals
 *   GET  /audit?paymentId=...       read the audit ledger
 *
 * Built on node:http so the skeleton carries zero runtime dependencies.
 */

export interface HttpResult {
  status: number;
  body: unknown;
}

/** Route one request to the wallet. Pure — no I/O — so it is easy to test. */
export async function routeHttpRequest(
  wallet: WalletDaemon,
  method: string,
  path: string,
  query: URLSearchParams,
  body: unknown,
): Promise<HttpResult> {
  if (method === "POST" && path === "/pay") {
    const result = await wallet.pay(body as PaymentInput);
    return { status: 200, body: result };
  }

  const approvalMatch = /^\/approvals\/([^/]+)\/resolve$/.exec(path);
  if (method === "POST" && approvalMatch) {
    const approved = Boolean((body as { approved?: unknown })?.approved);
    const result = await wallet.resolveApproval(approvalMatch[1], approved);
    return { status: 200, body: result };
  }

  if (method === "GET" && path === "/approvals") {
    return { status: 200, body: wallet.listPendingApprovals() };
  }

  if (method === "GET" && path === "/audit") {
    const paymentId = query.get("paymentId") ?? undefined;
    return { status: 200, body: wallet.audit(paymentId) };
  }

  return { status: 404, body: { error: `no route for ${method} ${path}` } };
}

/** Start the HTTP surface on `port`. Returns the underlying server. */
export function startHttpServer(wallet: WalletDaemon, port = 4022): Server {
  const server = createServer((req, res) => {
    void handle(wallet, req, res);
  });
  server.listen(port, () => {
    console.log(`agent-wallet HTTP surface on http://localhost:${port}`);
  });
  return server;
}

async function handle(
  wallet: WalletDaemon,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const raw = await readBody(req);
    const body: unknown = raw ? JSON.parse(raw) : undefined;
    const result = await routeHttpRequest(
      wallet,
      req.method ?? "GET",
      url.pathname,
      url.searchParams,
      body,
    );
    res.writeHead(result.status, { "content-type": "application/json" });
    res.end(JSON.stringify(result.body, bigintReplacer));
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
