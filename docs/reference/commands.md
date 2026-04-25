# Static Commands Reference

**Scope**: user-facing `/commands` handled by the gateway before the
agent. Handlers live in `shared/commands/`.
**Out of scope**: Pi Agent tools ([tools.md](./tools.md)), referral flow
([../config/allowlist.md](../config/allowlist.md)).

Source of truth: `shared/commands/index.mjs`, `shared/commands/carrinho.mjs`,
`shared/commands/admin.mjs`.

Commands are matched case-insensitively after trimming. They short-circuit
the agent: the gateway publishes directly to `msg.flow outgoing`.

## Alias table

| Input | Resolves to |
|-------|-------------|
| `ajuda`, `/ajuda` | `/ajuda` |
| `modelo`, `/modelo`, `/modelo <n>`, `modelo <n>` | `/modelo` |
| `indicar`, `/indicar`, `meucodigo`, `/meucodigo` | `/indicar` |
| `carrinho`, `/carrinho`, `pedido`, `/pedido` | `/carrinho` |
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

### `/carrinho` (alias: `/pedido`)

Show the current state: a pending order takes precedence over the cart.

- Params: none.
- Reads: `orders.getPending(phone)` first; falls back to `cart_items`
  joined with `products`.
- Pending order → item lines, total, prompt to `/confirma` or `/cancelar`.
- No pending, empty cart → "Carrinho vazio…"
- No pending, non-empty cart → item lines + subtotal.
- Handler: `shared/commands/carrinho.mjs`. `/pedido` is kept as an alias
  for backward compatibility.

While an order is pending, the `add_to_cart`, `checkout`, and
`create_order` tools are blocked — the customer must `/confirma` or
`/cancelar` first.

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

### `/admin` · `/admin <subcommand> [args]`

Privileged commands for the bot operator. **Only handled when the message
arrives via WhatsApp self-chat from the bot's own number** — see
[Admin self-chat security](#admin-self-chat-security) below. Non-admin
`/admin` traffic is silently dropped.

Subcommands:

| Subcommand | Effect |
|------------|--------|
| `/admin` | Print the admin help menu (registry-driven). |
| `/admin autorizar <telefone>` | Mark the phone as `access_status='active'`, stamp `referred_by_phone='admin'` if no prior referrer, and send a welcome message to the invited phone instructing `/ajuda`. Idempotent. |

Phone normalization: digits only; if the country code `55` is missing it
is prepended. Final length must be 12 or 13 digits (Brazil: `55 + DDD +
8/9-digit number`). Invalid input returns an error to the operator
without contacting the target.

The welcome message is published directly to `msg.flow` with routing key
`send` (consumed by `whatsapp.send` in the bridge). It bypasses the
sender's humanization delay because it's system-initiated, and the
target phone is different from the envelope's `phone` (which is the
operator's number).

Audit: every admin command is logged via `console.log("[admin][audit] …")`
with the operator phone, subcommand, args, and outcome.

#### Admin self-chat security

The admin identity rule is: `key.fromMe === true` AND the JID strips to
`BOT_PHONE`. This is the WhatsApp self-chat ("Recado para mim") pattern.
Three independent gates enforce it:

1. **Bridge** (`shared/lib/baileys-client.mjs`): `selfPhone` option drops
   every `fromMe` event whose `remoteJid` is not the bot's own number.
   Without this, the bot's own outbound replies (also `fromMe`) would
   loop back into the pipeline.
2. **Gateway** (`consumers/gateway.mjs`): re-derives `isAdmin = fromMe &&
   phone === BOT_PHONE`, sets `metadata.actor = "admin" | "customer"`,
   and bypasses rate-limit + allowlist for admin. Stray non-admin
   `fromMe` is dropped here as defense in depth. Non-admin `/admin` text
   is silently ignored — never returned as "unknown command" so the
   surface isn't discoverable.
3. **Command handler** (`shared/commands/admin.mjs`): `tryHandleAdmin`
   re-asserts `ctx.actor === "admin"` before any privileged write.

If any single gate is bypassed by a future refactor, the others still
hold. WhatsApp's own message keys are server-signed, so `fromMe` cannot
be spoofed by a third party in production. The dev test injection
script (`setup/send-test-message.mjs`) hardcodes `fromMe: false`.

#### Adding a new admin subcommand

1. Append an entry to `SUBCOMMANDS` in `shared/commands/admin.mjs`.
2. Add a `case` to the `switch` in `tryHandleAdmin` and write the
   handler. Re-verify `ctx.actor === "admin"` is implicit (the dispatcher
   checks once); if your handler can be called from elsewhere, re-check.
3. If the command needs to send to a phone other than the operator's,
   publish to `msg.flow` with routing key `send` and an explicit
   `{ phone, action: "text", text }` payload.

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
