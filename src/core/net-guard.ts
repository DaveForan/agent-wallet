import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { WalletError } from "./errors.ts";

export interface UrlGuardOptions {
  /** Allow loopback / private / link-local targets — for local testing only. */
  allowPrivate?: boolean;
}

type HostKind = "loopback" | "private" | "link-local" | "unspecified" | "public";

/**
 * SSRF guard for the wallet's outbound fetches.
 *
 * The wallet fetches agent-supplied URLs (x402 resources, ACP merchant
 * endpoints). {@link guardedFetch} rejects non-HTTP(S) schemes, literal
 * private addresses, and — crucially — hostnames that *resolve* into a
 * private range, so a DNS name pointing at an internal service is blocked.
 *
 * Residual: a host that resolves public for the check and rebinds to a
 * private IP microseconds later, when the OS resolves it again for the
 * connection, is not caught — closing that needs connection-time IP pinning,
 * which does not compose with Node's global fetch.
 */

/** Throw if `rawUrl` has a non-HTTP(S) scheme or a literal private host. */
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

/**
 * A `fetch` that is SSRF-guarded: it checks the scheme and literal host, then
 * resolves the hostname and rejects the request if any resolved address is
 * private — before any connection is made.
 */
export function guardedFetch(opts: UrlGuardOptions = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const target =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    assertSafeUrl(target, opts);
    if (!opts.allowPrivate) {
      await assertResolvesPublic(new URL(target).hostname);
    }
    return fetch(input, init);
  }) as typeof fetch;
}

/** Resolve a DNS hostname and throw if any resolved address is not public. */
async function assertResolvesPublic(hostname: string): Promise<void> {
  const bare =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  // A literal IP was already classified by assertSafeUrl.
  if (isIP(bare) !== 0) return;

  let addresses: { address: string }[];
  try {
    addresses = await dnsLookup(hostname, { all: true });
  } catch {
    throw new WalletError(
      `refusing to fetch ${hostname}: DNS resolution failed`,
    );
  }
  for (const addr of addresses) {
    const kind = classifyIp(addr.address);
    if (kind !== "public") {
      throw new WalletError(
        `refusing to fetch ${hostname}: it resolves to a ${kind} address ` +
          `(${addr.address}) — possible SSRF`,
      );
    }
  }
}

/** Classify a URL hostname; returns undefined for an ordinary DNS name. */
function classifyHost(hostname: string): HostKind | undefined {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return isIP(bare) ? classifyIp(bare) : undefined;
}

/** Classify a raw IPv4/IPv6 address. */
function classifyIp(ip: string): HostKind {
  const version = isIP(ip);
  if (version === 4) return classifyV4(ip);
  if (version === 6) return classifyV6(ip);
  return "public";
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
