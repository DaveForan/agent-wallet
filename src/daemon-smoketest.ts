/**
 * Smoke test for the unified daemon: `npm run daemon:check`.
 *
 * Spawns the daemon and proves the MCP, payment and control surfaces all
 * drive ONE wallet:
 *  - a mandate the operator creates via the control API is visible to the
 *    MCP agent;
 *  - a payment the MCP agent requests shows up in the operator's queue;
 *  - an operator freeze blocks the MCP agent.
 */

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DB_PATH = join(tmpdir(), `agent-wallet-daemon-${Date.now()}.db`);
const MCP_PORT = 4224;
const PAY_PORT = 4222;
const CONTROL_PORT = 4223;
const TOKEN = "daemon-smoketest-token";

let passed = 0;
function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`  ok  ${label}`);
  passed++;
}

/** Pull the text content out of an MCP tool-call result. */
function textOf(result: unknown): string {
  const content = (
    result as { content?: { type?: string; text?: string }[] }
  ).content;
  return content?.find((b) => b.type === "text")?.text ?? "";
}

/** Wait until the daemon's control surface answers. */
async function waitForDaemon(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `http://localhost:${CONTROL_PORT}/status?token=${TOKEN}`,
      );
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  throw new Error("daemon did not come up");
}

/** Call the operator control API with the bearer token. */
async function control(
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const res = await fetch(`http://localhost:${CONTROL_PORT}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function main(): Promise<void> {
  const daemonScript = new URL("./daemon.ts", import.meta.url).pathname;
  const daemon = spawn(process.execPath, [daemonScript], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      AGENT_WALLET_DB: DB_PATH,
      AGENT_WALLET_MCP_PORT: String(MCP_PORT),
      AGENT_WALLET_PAY_PORT: String(PAY_PORT),
      AGENT_WALLET_CONTROL_PORT: String(CONTROL_PORT),
      AGENT_WALLET_CONTROL_TOKEN: TOKEN,
    },
  });

  const client = new Client({ name: "daemon-smoketest", version: "0.0.1" });

  try {
    await waitForDaemon();

    // The MCP agent connects to the daemon over Streamable HTTP.
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://localhost:${MCP_PORT}/mcp`),
      ),
    );
    const tools = await client.listTools();
    check(
      "MCP-over-HTTP advertises the wallet tools",
      tools.tools.some((t) => t.name === "request_payment"),
    );

    // The operator creates a mandate via the control API...
    await control("POST", "/mandates", {
      id: "shared-mandate",
      grantedBy: "operator",
      cap: { amount: "100000", currency: "USD" },
      rails: ["x402", "stripe"],
    });

    // ...and the MCP agent sees that same mandate.
    const listed = await client.callTool({
      name: "list_mandates",
      arguments: {},
    });
    const mandates = JSON.parse(textOf(listed)) as { id: string }[];
    check(
      "a control-created mandate is visible to the MCP agent",
      mandates.some((m) => m.id === "shared-mandate"),
    );

    // The MCP agent requests a $5 payment — over the $1 auto-approve line.
    const payResult = await client.callTool({
      name: "request_payment",
      arguments: {
        rail: "x402",
        amount: "500",
        currency: "USD",
        payeeAddress: "https://api.example.com",
        mandateId: "shared-mandate",
      },
    });
    const pay = JSON.parse(textOf(payResult)) as {
      result?: { status?: string };
    };
    check(
      "the MCP agent's payment escalates for approval",
      pay.result?.status === "pending_approval",
    );

    // ...and it appears in the operator's approval queue.
    const approvals = (await control("GET", "/approvals")) as unknown[];
    check(
      "the MCP agent's payment is in the operator's queue",
      approvals.length === 1,
    );

    // The operator freezes the wallet...
    await control("POST", "/freeze", { reason: "daemon smoke test" });

    // ...and the MCP agent is blocked by it.
    const blockedResult = await client.callTool({
      name: "request_payment",
      arguments: {
        rail: "x402",
        amount: "10",
        currency: "USD",
        payeeAddress: "https://api.example.com",
        mandateId: "shared-mandate",
      },
    });
    const blocked = JSON.parse(textOf(blockedResult)) as {
      result?: { status?: string; reason?: string };
    };
    check(
      "an operator freeze blocks the MCP agent",
      blocked.result?.status === "denied" &&
        /frozen/.test(blocked.result.reason ?? ""),
    );

    console.log(
      `\nAll ${passed} checks passed — one wallet across MCP, payment and control.`,
    );
  } finally {
    await client.close().catch(() => undefined);
    daemon.kill();
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(DB_PATH + suffix, { force: true });
    }
  });
