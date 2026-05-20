# Agentic checkout

For any merchant that supports the **Agentic Commerce Protocol (ACP)**, the
agent can shop and the wallet governs by *what is in the cart* — not just
the total.

## The flow

1. The agent creates a checkout session with the merchant
   (`acp_create_checkout`). The merchant returns a session with line items,
   prices and a total.
2. Optionally, the agent refines it (`acp_update_checkout`).
3. The agent calls `pay_checkout` with the session id + an authorised ceiling.
4. The wallet **re-fetches the session directly from the merchant** — the
   agent's claimed cart is replaced with what the merchant actually states.
5. The **policy engine** evaluates the verified cart: line-item categories,
   per-item cap, merchant domain, total ≤ authorised amount.
6. If allowed, the wallet **mints a Stripe Shared Payment Token** scoped to
   *(this merchant, this exact total, a short TTL)*, against the registered
   funding source.
7. The wallet **completes** the merchant's checkout with the token.
8. The merchant order id is recorded on the audit ledger — reconciliable
   against the merchant's books.

The SPT's three constraints — merchant, amount, expiry — are the policy
decision made concrete. The merchant never sees a card number; the agent
never holds a reusable credential.

## Setup the operator does first

1. **Register a funding source**: in the *Funding source* card, add a
   Stripe `pm_…` id (and brand / last4 / label for display).
2. **Create a shopping mandate**: in the *Mandates* card, set the cap, the
   `allowedMerchantDomains` (the host of every merchant the agent may pay),
   any `blockedCategories`, and optionally an `agentId` to scope the mandate
   to one specific agent.

## The agent's tools

### `acp_create_checkout`

Open a checkout session with an ACP merchant.

```jsonc
{
  "merchantEndpoint": "https://shop.example.com/acp",
  "currency": "USD",
  "items": [
    { "itemId": "sku_milk_2pct_half_gallon", "quantity": 2 },
    { "itemId": "sku_sourdough", "quantity": 1 }
  ],
  "buyerEmail": "buyer@example.com"
}
```

Returns the merchant's session — id, line items with prices, totals, status.

### `acp_update_checkout`

Replace the line items. Useful when the agent refines the cart based on the
merchant's response.

```jsonc
{
  "merchantEndpoint": "https://shop.example.com/acp",
  "sessionId": "cs_...",
  "items": [{ "itemId": "sku_sourdough", "quantity": 2 }]
}
```

### `acp_checkout_status`

Fetch the current state of a session — useful before paying to confirm what
the merchant believes the cart is.

### `pay_checkout`

The pay step. The agent passes a *pointer* to the session and an authorised
ceiling; the wallet re-fetches and verifies the session itself.

```jsonc
{
  "merchantEndpoint": "https://shop.example.com/acp",
  "merchantId": "grocer-1",
  "merchantName": "Real Grocer",
  "sessionId": "cs_...",
  "maxAmount": "15000",
  "currency": "USD",
  "mandateId": "groceries",
  "memo": "weekly groceries"
}
```

The `maxAmount` is the ceiling the agent authorises; the merchant's actual
total must be ≤ this *and* ≤ the mandate's cap.

## What the wallet enforces

Before the rail settles anything, the policy engine checks (every one is
optional on the mandate):

- The merchant's ACP endpoint host is in `allowedMerchantDomains`.
- The merchant id is in `allowedMerchants` (a soft check — the agent supplies
  the id).
- Every line item's category is in `allowedCategories` (if set).
- No line item is in `blockedCategories` (if set).
- No line item's unit price exceeds `perItemCap` (if set).
- The merchant-stated total ≤ the agent's `maxAmount`.
- The cart's contribution stays within the lifetime / window cap.
- The calling agent matches `mandate.agentId` (if scoped).

## What the operator sees

The approval queue shows the cart's line items, the merchant, and the total —
not just a number. On settlement, the *Merchant orders* section of the spend
report shows the merchant order id alongside the payment for reconciliation.

## Live verification status

The ACP rail is implemented and unit-tested against mocks. Running it end to
end needs Stripe Shared Payment Token program access and a real ACP merchant —
external dependencies, not project work. The guard paths (no cart / no funding
source / no merchant profile / unverifiable session) are all unit-tested and
the `acp:` smoke checks pass.
