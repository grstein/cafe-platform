# Pi Agent Tools Reference

**Scope**: the 11 custom tools registered with every Pi Agent session.
**Out of scope**: static commands ([commands.md](./commands.md)), skills
([../config/skills.md](../config/skills.md)).

Source of truth: `shared/tools/*.mjs`. Tools are wired in
`consumers/agent.mjs::buildCustomTools`.

All tools return the Pi SDK shape:

```ts
{
  content: [{ type: "text", text: "<what the LLM sees>" }],
  details: { /* structured fields, logged but not sent to LLM */ }
}
```

## Catalog

### `search_catalog`

Search the product catalog. Use before recommending anything.

- File: `shared/tools/catalog-tools.mjs`
- Params (all optional):
  - `query: string` — ILIKE match against `name`, `profile`, `roaster`, `origin`
  - `max_price: number`
  - `min_sca: number`
  - `available_only: boolean` (default `true`)
- Returns: text listing of matching products with SKU, name, price,
  roaster, SCA, profile, origin, process, weight, highlight,
  availability. `details.count` and `details.products[]`.
- Empty result: "Nenhum produto encontrado para os filtros informados."

## Cart

Cart tools operate on the current `phone` (bound at tool creation time).

### `add_to_cart`

- Params: `sku: string`, `qty?: number` (default 1).
- Validates SKU exists and is available. Unknown → error; unavailable →
  error.
- Upserts into `cart_items` (UNIQUE on `(phone, product_sku)`; `qty` is
  **added** to existing).
- Returns: new cart summary (items, subtotal, count).

### `update_cart`

- Params: `sku: string`, `qty: number`.
- `qty <= 0` → removes the item.
- Unknown SKU in cart → error "não está no carrinho".
- Returns: new cart summary.

### `remove_from_cart`

- Params: `sku: string`.
- Returns: new cart summary, or "Item removido. Carrinho vazio agora." if
  last item.

### `view_cart`

- Params: none.
- Returns: cart summary or "Carrinho vazio."

### `checkout`

- Params: `customer_name: string`, `cep?: string`, `notes?: string`.
- Reprices each cart item against current catalog price; refuses if any
  item went unavailable.
- Updates `customers.name` (and `cep` if provided).
- Creates an `orders` row with `status = "pending"`. Clears the cart.
- Returns: text summary ending with "Instrua o cliente a enviar
  /confirma…". `details = { orderId, phone, items, total }`.

## Orders

### `create_order`

Register an order **without using the cart** (used when the agent skips
cart assembly).

- File: `shared/tools/order-tools.mjs`
- Params:
  - `customer_name: string`
  - `cep?: string`
  - `items: Array<{ sku, name, qty, unit_price }>`
  - `notes?: string`
- Validates every item against the catalog (SKU exists, available, price
  matches within R$0.01). Any mismatch → error with the canonical price.
- Creates an `orders` row with `status = "pending"`. Does **not** touch
  the cart.
- Returns: text summary + `/confirma` / `/cancelar` instruction.

### `list_orders`

- Params: `status?: string` (`pending`, `confirmed`, `paid`, `shipped`,
  `delivered`, `cancelled`), `limit?: number` (default 10).
- Returns one line per order: `#<prefix><id> | dd/mm/yyyy | <status> |
  <items> | R$ <total>`, plus total spent across non-cancelled,
  non-pending orders.

## Customer

### `save_customer_info`

- File: `shared/tools/customer-tools.mjs`
- Params (all optional):
  - `name`, `cep`, `email`, `city`, `state` — written to dedicated columns
  - `preferences: { perfil?, metodo?, moagem?, intensidade? }` — merged
    into `customers.preferences` JSON
- Returns confirmation text summarizing what was saved (per the prompt
  guideline: the agent is told NOT to echo this to the user — it should
  use the info naturally later).

## Referral

Referral tools need `phone`, `repos`, `botPhone`, `displayName` at
construction (see `consumers/agent.mjs`).

### `invite_customer`

Pre-authorize a WhatsApp number by referral.

- File: `shared/tools/referral-tools.mjs`
- Params: `invited_phone: string`, `invited_name?: string`.
- Normalizes the phone to digits-only.
- If the invited phone already exists and is not `blocked` → "Esse número
  já tem acesso…", no write.
- Otherwise: upserts the invitee with `access_status="invited"`,
  `referred_by_phone=<referrer>`; creates a `referrals` row.
- Returns: text confirming access is open, and that the referrer earns
  10% when the invitee first buys.

### `get_referral_info`

- Params: none.
- Returns: text with referral code, `wa.me` link (if `BOT_PHONE` set),
  total/active invites, pending rewards (from
  `referrals.getPendingRewards`).

## Tool wiring

In `consumers/agent.mjs::buildCustomTools`:

```js
return [
  ...createOrderTools(phone, r),
  ...createCatalogTools(r),
  ...createCustomerTools(phone, r),
  ...createCartTools(phone, r),
  ...createReferralTools(phone, r, botPhone, displayName),
];
```

Each factory returns an array of `defineTool(...)` results from
`@mariozechner/pi-coding-agent`. Parameter schemas are defined with
`@sinclair/typebox` (`Type.Object(...)`).

## Adding a new tool

1. Add or create a file under `shared/tools/<domain>-tools.mjs` exporting
   a `create<Domain>Tools(phone, repos, ...)` function that returns an
   array of tools.
2. Use `defineTool({ name, label, description, promptSnippet,
   promptGuidelines: [...], parameters: Type.Object(...), async
   execute(toolCallId, params) { ... } })`.
3. Return content in the shape above: `{ content: [{ type: "text", text }], details }`.
4. Import the factory in `consumers/agent.mjs` and include it in
   `buildCustomTools`.
5. Document the tool in `pi-config/AGENTS.md` under "Ferramentas
   Disponíveis" so the model knows it exists and when to use it.
6. Restart the `agent` consumer.

## Related

- [commands.md](./commands.md) — for text-in/text-out operations without
  DB writes, prefer a static command.
- [../config/agents-md.md](../config/agents-md.md) — where to document
  tools for the LLM.
- [../config/products.md](../config/products.md) — data that
  `search_catalog` reads.
