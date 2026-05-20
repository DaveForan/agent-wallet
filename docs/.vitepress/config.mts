import { defineConfig } from "vitepress";

// Set DOCS_BASE in the deploy workflow if your GitHub Pages URL is not
// `username.github.io/agent-wallet/`.
const base = process.env["DOCS_BASE"] ?? "/agent-wallet/";

export default defineConfig({
  title: "agent-wallet",
  description: "A policy-governed payment wallet for AI agents.",
  base,
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Reference", link: "/api-reference" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/getting-started" },
          { text: "Core concepts", link: "/concepts" },
          { text: "For operators", link: "/operator-guide" },
          { text: "For agents", link: "/agent-guide" },
          { text: "Agentic checkout", link: "/agentic-checkout" },
          { text: "Payment rails", link: "/rails" },
          { text: "Security posture", link: "/security" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "API reference", link: "/api-reference" },
          { text: "Configuration", link: "/configuration" },
        ],
      },
    ],
    search: { provider: "local" },
    footer: {
      message: "A policy-governed payment wallet for AI agents.",
    },
  },
});
