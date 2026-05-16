/**
 * Smoke test for the MCP surface: `npm run mcp:check`.
 *
 * Spawns the stdio MCP server as a child process, connects a real MCP client
 * to it, and exercises the tools — proving the transport wiring end to end.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** Pull the text content out of a tool-call result. */
function toText(result: unknown): string {
  const content = (
    result as { content?: Array<{ type: string; text?: string }> }
  ).content;
  if (!content) return JSON.stringify(result);
  return content
    .map((block) => (block.type === "text" ? (block.text ?? "") : `[${block.type}]`))
    .join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

async function main(): Promise<void> {
  const serverScript = new URL("./mcp-main.ts", import.meta.url).pathname;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverScript],
  });
  const client = new Client({
    name: "agent-wallet-smoketest",
    version: "0.0.1",
  });

  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`tools advertised: ${tools.map((t) => t.name).join(", ")}`);

  console.log("\nrequest_payment — $25.00, over the $10.00 per-txn cap:");
  const denied = await client.callTool({
    name: "request_payment",
    arguments: {
      rail: "x402",
      amount: "2500",
      currency: "USD",
      payeeAddress: "https://api.example.com",
      memo: "smoke test",
      mandateId: "default",
    },
  });
  console.log(indent(toText(denied)));

  console.log("\nlist_mandates:");
  const mandates = await client.callTool({
    name: "list_mandates",
    arguments: {},
  });
  console.log(indent(toText(mandates)));

  await client.close();
  console.log("\nMCP server smoke test passed.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
