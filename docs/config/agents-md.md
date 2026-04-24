# `pi-config/AGENTS.md` — Authoring Guide

**Scope**: the `AGENTS.md` file that shapes the LLM's persona, business
context, and tool usage rules.
**Out of scope**: skill files ([skills.md](./skills.md)), tool definitions
([../reference/tools.md](../reference/tools.md)).

Source of truth: the Pi Agent SDK — `AGENTS.md` is discovered by walking
up from `cwd` (set to `CONFIG_DIR` in `consumers/agent.mjs`) and injected
into the system prompt of **every new session**.

## When it is read

Every time a new Pi SDK session is created — i.e., first message from a
phone, or first message after the session cache expires
(`session.ttl_minutes`), or after `/reiniciar`.

Cached sessions keep the `AGENTS.md` copy from their creation time.
Restart the `agent` consumer or let the cache expire to pick up edits.

## Recommended structure

The SDK does not enforce any structure — anything you write goes into the
system prompt verbatim. The template in `examples/pi-config/AGENTS.md`
uses these sections, which have proven to work well:

1. **Title** — one-line `# <Business name> — purpose`
2. **Papel (Role)** — who the agent is and who it serves
3. **Princípios (Principles)** — tone, language, brevity rules, honesty
   rules, emoji policy
4. **Ferramentas Disponíveis (Available Tools)** — one bullet per tool
   with a short "when to use" note. Must match the tools wired in
   `consumers/agent.mjs::buildCustomTools`
5. **Fluxo de Atendimento (Conversation Flow)** — numbered steps of the
   typical path from greeting → order
6. **O Que Evitar (What to Avoid)** — explicit guardrails
7. **Quando Escalar (When to Escalate)** — out-of-scope triggers
8. **Sobre o <Business>** — name, segment, address, hours
9. **Horário de Atendimento**
10. **Endereço**
11. **Formas de Recebimento** (pickup, delivery)
12. **Formas de Pagamento** (mention `/confirma` flow and PIX)
13. **Política de Cancelamento** (mention `/cancelar`)
14. **Tom de Voz (Voice)**

## Guardrails that matter

These phrases have measurable effect on behavior and are worth keeping:

- "Nunca invente produtos, preços ou disponibilidade. Sempre consulte o
  catálogo pelas tools." — prevents hallucinated SKUs.
- "Não execute `create_order` ou `checkout` sem confirmação dos itens e
  forma de recebimento." — prevents premature order creation.
- "Uma pergunta por vez." — prevents overwhelming the user.
- "Não repita literalmente a saída das tools — resuma em linguagem
  natural." — prevents raw JSON-like responses.

## Language

The reference template is in pt-BR because the platform is Brazil-first
(PIX, CEP, Portuguese UI). Write `AGENTS.md` in the language you want the
agent to respond in.

## Cross-referencing commands and tools

Mention static commands by name so the agent knows to redirect to them
instead of trying to handle them itself. The commands are handled by
`shared/commands/` *before* the message reaches the agent, so the agent
should treat them as "the system handles this when the user sends X".

Full list to reference:
`/ajuda`, `/carrinho` (alias `/pedido`), `/confirma`, `/cancelar`,
`/reiniciar`, `/indicar`, `/modelo`. See
[../reference/commands.md](../reference/commands.md).

Full list of tools to mention:
`search_catalog`, `add_to_cart`, `update_cart`, `remove_from_cart`,
`view_cart`, `checkout`, `create_order`, `list_orders`,
`save_customer_info`, `invite_customer`, `get_referral_info`. See
[../reference/tools.md](../reference/tools.md).

## Testing changes

1. Edit `pi-config/AGENTS.md`.
2. Restart the `agent` consumer:
   `docker compose restart agent`.
3. Send a test message:
   `docker compose exec gateway node setup/send-test-message.mjs "oi"`.
4. Or send `/reiniciar` from a real WhatsApp to force a fresh session.

## Related

- [skills.md](./skills.md) — for rare/detailed procedures, prefer a skill
  over stuffing AGENTS.md (skill bodies are loaded on demand, saving
  tokens).
- [../reference/tools.md](../reference/tools.md) — canonical tool reference.
- [../reference/commands.md](../reference/commands.md) — canonical command
  reference.
- `examples/pi-config/AGENTS.md` — starter template.
