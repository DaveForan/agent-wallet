import {
  createServer,
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
export function serve(name: string, router: HttpRouter, port: number): Server {
  const server = createServer((req, res) => {
    void dispatch(router, req, res);
  });
  server.listen(port, () => {
    console.log(`agent-wallet ${name} on http://localhost:${port}`);
  });
  return server;
}

async function dispatch(
  router: HttpRouter,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const raw = await readBody(req);
    const body: unknown = raw ? JSON.parse(raw) : undefined;
    const result = await router(
      req.method ?? "GET",
      url.pathname,
      url.searchParams,
      body,
    );
    if (result.contentType) {
      res.writeHead(result.status, { "content-type": result.contentType });
      res.end(String(result.body));
    } else {
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(JSON.stringify(result.body, bigintReplacer));
    }
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
