# Static Commands Reference

**Scope**: user-facing `/commands` handled by the gateway before the
agent. Handlers live in `shared/commands/`.
**Out of scope**: Pi Agent tools ([tools.md](./tools.md)), referral flow
([../config/allowlist.md](../config/allowlist.md)).

Source of truth: `shared/commands/index.mjs`, `shared/commands/carrinho.mjs`.

Commands are matched case-insensitively after trimming. They short-circuit
the agent: the gateway publishes directly to `msg.flow outgoing`.

## Alias table

| Input | Resolves to |
|-------|-------------|
| `ajuda`, `/ajuda` | `/ajuda` |
| `modelo`, `/modelo`, `/modelo <n>`, `modelo <n>` | `/modelo` |
| `indicar`, `/indicar`, `meucodigo`, `/meucodigo` | `/indicar` |
| `carrinho`, `/carrinho` | `/carrinho` |
| `pedido`, `/pedido` | `/pedido` |
| `confirma`, `confirmar`, `/confirma`, `/confirmar` | `/confirma` |
| `cancelar`, `cancela`, `/cancelar`, `/cancela` | `/cancelar` |
| `reiniciar`, `/reiniciar` | `/reiniciar` |

Unknown input returns `null` from `tryHandle()` → the gateway routes it
to the aggregator/agent instead.

## Commands

### `/ajuda`

Help menu. Lists commands + current LLM model.

- Params: none.
- Reads: `customers.preferences.modelo`, `app_config.available_models`,
  `app_config.display_name`.
- Side effects: none.
- Response: multi-line text, ends with current model name.

### `/modelo` · `/modelo <N>`

LLM model switcher.

- Params: optional 1-based index `N`.
- Without `N`: lists `app_config.available_models`, marks current one.
- With `N`: sets `customers.preferences.modelo = available_models[N-1].id`,
  returns `resetSession: true` (gateway publishes `session_reset` event →
  agent disposes the cached session).
- Errors: invalid index → "Número inválido. Escolha de 1 a <n>."
- Errors: empty `available_models` → "Nenhum modelo disponível."

### `/indicar` · `/meucodigo`

Show the customer's referral code + shareable `wa.me` link.

- Params: none.
- Side effects: creates the referral code if the customer doesn't have
  one (`customers.ensureReferralCode`).
- Response includes a `wa.me/<BOT_PHONE>?text=<code>` link if `BOT_PHONE`
  (or `app_config.bot_phone`) is set.
- Response: "Seu código: <code>. Link: …. Quando seu indicado fizer a
  primeira compra, você ganha 10% de desconto."

### `/carrinho`

Show current cart contents.

- Params: none.
- Reads: `cart_items` joined with `products` for names.
- Empty cart → "Carrinho vazio."
- Non-empty → item lines + subtotal. Handler: `shared/commands/carrinho.mjs`.

### `/pedido`

Show the pending (unconfirmed) order, if any.

- Params: none.
- Reads: `orders.getPending(phone)` — returns the most recent order with
  `status = "pending"`.
- No pending → "Nenhum pedido pendente no momento…"
- Pending → item lines, total, and prompt to `/confirma` or `/cancelar`.

### `/confirma`

Confirm the pending order. Emits the PIX BR Code.

- Params: none.
- Reads: `orders.confirm(phone)`, `customers.*`, `referrals.*`.
- Requires `PIX_KEY` (env) — returns "Erro interno: chave PIX não
  configurada." otherwise.
- Side effects:
  - Sets order status `confirmed`.
  - If the customer was referred and has zero prior orders:
    `referrals.activate(phone)`.
  - If the customer was `invited`: flips `access_status` to `active`.
  - `customers.updateCounters(phone)` increments total_orders/total_spent.
- Response: confirmation text + a **second** message containing the raw
  PIX BR Code string (`result.messages = [instructions, brcode]`). The
  sender delivers both sequentially.

### `/cancelar`

Cancel the pending order.

- Params: none.
- `orders.cancel(phone)` — sets status `cancelled`, `cancelled_at = NOW()`.
- No pending → "Nenhum pedido pendente para cancelar."
- Cancelled → "Pedido #<prefix><id> cancelado. Quando quiser, é só me chamar."

### `/reiniciar`

Reset the agent session for this phone.

- Params: none.
- Returns `resetSession: true`. Gateway publishes `session_reset` to the
  `events` exchange; the agent consumer disposes the cached Pi SDK
  session for this phone.
- Does **not** clear DB state (conversations, cart, orders).
- Response: "Conversa reiniciada! Como posso te ajudar?"

## Command result shape

Every handler returns (or resolves to) a `CommandResult`:

```ts
{
  command:      string,                  // canonical name without the slash
  text:         string,                  // displayed to user (or first message)
  messages?:    string[],                // if present, sender sends each sequentially
  resetSession?: boolean                 // if true, gateway emits session_reset
}
```

`null` from `tryHandle()` means "not a command — keep routing".

## Adding a new command

1. Add aliases to the `aliases` map in `shared/commands/index.mjs`.
2. Add a case to the `switch (resolved)` block.
3. Write a `handle<Name>(phone, …)` function in the same file (or a new
   file under `shared/commands/` if it's non-trivial, following the
   `carrinho.mjs` pattern).
4. Document the command in `pi-config/AGENTS.md` so the LLM redirects to
   it instead of trying to handle it itself.
5. Add the command to `/ajuda`'s list (in `handleAjuda`).

No registration happens outside `shared/commands/index.mjs` —
`createCommandHandlers` is the single entry point invoked from
`consumers/gateway.mjs`.

## Related

- [../config/allowlist.md](../config/allowlist.md) — referral flow that
  `/indicar` feeds into.
- [tools.md](./tools.md) — for operations that need DB writes or
  structured output (prefer a tool).
