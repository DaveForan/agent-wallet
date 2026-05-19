import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { bigintReplacer, type Money } from "../core/types.ts";

/** The result of routing one HTTP request. */
export interface HttpResult {
  status: number;
  body: unknown;
  /**
   * Content type of the response. When set, `body` is sent verbatim as a
   * string (used to serve the control UI's HTML). When omitted, `body` is
   * JSON-encoded.
   */
  contentType?: string;
}

/** A pure request router: maps (method, path, query, body) to a result. */
export type HttpRouter = (
  method: string,
  path: string,
  query: URLSearchParams,
  body: unknown,
) => Promise<HttpResult>;

/** What an `authorize` predicate sees about a request — never the body. */
export interface AuthContext {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
}

/** Options for {@link serve}. */
export interface ServeOptions {
  /**
   * Gate every request. When provided and it returns false, the request is
   * rejected with 401 before the body is read or the router runs.
   */
  authorize?: (ctx: AuthContext) => boolean;
  /** Interface to bind. Defaults to 127.0.0.1 — never expose to the network. */
  host?: string;
}

/** Largest request body the wallet will read — guards against memory exhaustion. */
const MAX_BODY_BYTES = 1_000_000;

/**
 * Parse an untrusted JSON value into a {@link Money}. JSON cannot carry a
 * bigint, so an incoming amount arrives as a number or string — this restores
 * the bigint the wallet's arithmetic depends on.
 */
export function parseMoney(raw: unknown): Money {
  const value = (raw ?? {}) as { amount?: unknown; currency?: unknown };
  return {
    amount: BigInt(String(value.amount)),
    currency: String(value.currency),
  };
}

/** Start an HTTP server that dispatches every request through `router`. */
export function serve(
  name: string,
  router: HttpRouter,
  port: number,
  options: ServeOptions = {},
): Server {
  const server = createServer((req, res) => {
    void dispatch(router, req, res, options);
  });
  // Bind to loopback by default — the wallet's surfaces are local, and the
  // payment and MCP surfaces are unauthenticated.
  server.listen(port, options.host ?? "127.0.0.1", () => {
    console.log(`agent-wallet ${name} on http://localhost:${port}`);
  });
  return server;
}

async function dispatch(
  router: HttpRouter,
  req: IncomingMessage,
  res: ServerResponse,
  options: ServeOptions,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";

    if (
      options.authorize &&
      !options.authorize({
        method,
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
      })
    ) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    const raw = await readBody(req);
    const body: unknown = raw ? JSON.parse(raw) : undefined;
    const result = await router(method, url.pathname, url.searchParams, body);
    if (result.contentType) {
      res.writeHead(result.status, { "content-type": result.contentType });
      res.end(String(result.body));
    } else {
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(JSON.stringify(result.body, bigintReplacer));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("body too large") ? 413 : 500;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error(`request body too large (limit ${MAX_BODY_BYTES} bytes)`));
        return;
      }
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
