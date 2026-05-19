import { isIP } from "node:net";
import { WalletError } from "./errors.ts";

export interface UrlGuardOptions {
  /** Allow loopback / private / link-local targets — for local testing only. */
  allowPrivate?: boolean;
}

type HostKind = "loopback" | "private" | "link-local" | "unspecified" | "public";

/**
 * Throw if `rawUrl` is unsafe for the wallet to fetch — a non-HTTP(S) scheme,
 * or a literal private / loopback / link-local / metadata address. The wallet
 * fetches agent-supplied URLs (x402 resources, ACP endpoints); this blocks the
 * direct SSRF vectors, e.g. `http://169.254.169.254` (cloud metadata).
 *
 * It does *not* resolve DNS names — a hostname that resolves into a private
 * range is a residual gap that needs connection-time IP pinning to close.
 */
export function assertSafeUrl(
  rawUrl: string,
  opts: UrlGuardOptions = {},
): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WalletError(`refusing to fetch an invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new WalletError(`refusing to fetch a non-HTTP(S) URL: ${rawUrl}`);
  }
  if (opts.allowPrivate) return;
  const kind = classifyHost(url.hostname);
  if (kind && kind !== "public") {
    throw new WalletError(
      `refusing to fetch a ${kind} address (${url.hostname}) — possible SSRF`,
    );
  }
}

/** Wrap `fetch` so every request is SSRF-checked before it is sent. */
export function guardedFetch(opts: UrlGuardOptions = {}): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const target =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    assertSafeUrl(target, opts);
    return fetch(input, init);
  }) as typeof fetch;
}

/** Classify a URL hostname; returns undefined for an ordinary DNS name. */
function classifyHost(hostname: string): HostKind | undefined {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  // URL.hostname wraps an IPv6 literal in brackets.
  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const version = isIP(bare);
  if (version === 4) return classifyV4(bare);
  if (version === 6) return classifyV6(bare);
  return undefined; // a DNS name — this synchronous guard does not resolve it
}

function classifyV4(ip: string): HostKind {
  const o = ip.split(".").map(Number);
  if (o[0] === 127) return "loopback";
  if (o[0] === 0) return "unspecified";
  if (o[0] === 10) return "private";
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return "private";
  if (o[0] === 192 && o[1] === 168) return "private";
  if (o[0] === 169 && o[1] === 254) return "link-local";
  return "public";
}

function classifyV6(ip: string): HostKind {
  const v = ip.toLowerCase();
  if (v === "::1") return "loopback";
  if (v === "::") return "unspecified";
  if (v.startsWith("fe80")) return "link-local";
  if (v.startsWith("fc") || v.startsWith("fd")) return "private";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v);
  if (mapped) return classifyV4(mapped[1]);
  return "public";
}
