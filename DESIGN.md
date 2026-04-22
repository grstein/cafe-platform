# DESIGN.md

Visual design system for the **admin UI** of this platform. Prescriptive
contract for AI coding agents and implementers — absolute values, not
ranges. Keep in sync with what is actually shipped; do not aspire.

For the *functional* spec of the admin UI (screens, stack, routes, auth),
see [`docs/admin-ui.md`](./docs/admin-ui.md). For roadmap, see
[`TODO.md`](./TODO.md). This file is narrow on purpose.

---

## 1. Product & principles

The admin UI is the operator console for a single-tenant coffee-shop
WhatsApp+LLM bot. Primary user: the shop owner, usually on a phone,
during service. Secondary: a technical operator, occasionally, on a
laptop.

Five principles — in priority order when they conflict:

1. **Glanceable over detailed.** Every list answers one question in one
   second. Detail goes in a drawer, not the list.
2. **Reversible edits are silent; destructive ones are loud.** Editing
   a price is a click. Cancelling an order, purging a queue, or
   disconnecting the bridge requires typed confirmation.
3. **Dark-first, coffee-warm.** The room is often dim (café floor, late
   shift). Dark surfaces reduce glare; a single warm accent color ties
   the UI to the domain.
4. **Mobile is first-class for three screens only:** Dashboard, Orders,
   QR. Everything else may degrade gracefully but is not designed to be
   used primarily on a phone.
5. **Portuguese (pt-BR) for all operator-facing copy.** Status labels
   mirror the bot's own messages (`/confirma`, `/carrinho`, `pendente`,
   `pago`) so the operator sees the same words the customer sees.

---

## 2. Color tokens

Dark theme only in v1. Light theme deferred (see `TODO.md`).

### 2.1 Surfaces

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#0B1220` | Page background |
| `--surface-1` | `#121A2B` | Cards, drawers, table rows |
| `--surface-2` | `#1B2639` | Table header, hovered rows, nested panels |
| `--surface-3` | `#24324A` | Input fields, menu items |
| `--overlay` | `rgba(6, 10, 18, 0.72)` | Modal backdrop |

### 2.2 Text

| Token | Hex | Usage |
|---|---|---|
| `--text` | `#E6EAF2` | Primary text |
| `--text-muted` | `#9AA5B8` | Secondary text, placeholders, table labels |
| `--text-disabled` | `#5A6478` | Disabled |
| `--text-on-accent` | `#FFFFFF` | Text on `--accent` backgrounds |

### 2.3 Brand & interactive

| Token | Hex | Usage |
|---|---|---|
| `--accent` | `#8B5E34` | Primary buttons, active nav, focus ring |
| `--accent-hover` | `#A06E3F` | Hover on primary |
| `--accent-soft` | `rgba(139, 94, 52, 0.14)` | Active nav background, selected row |
| `--border` | `#2A3552` | Dividers, input borders |
| `--border-strong` | `#3C4A6E` | Focused input borders |

### 2.4 Semantic

Map 1:1 to the domain states in section 6.

| Token | Hex | Meaning |
|---|---|---|
| `--success` | `#2FB574` | `paid`, `delivered`, healthy |
| `--warning` | `#E3A008` | `pending`, `confirmed`, `shipped` (in flight), queue depth rising |
| `--danger` | `#E24C4B` | `cancelled`, errors, DLX > 0, disconnected |
| `--info` | `#4F9CF9` | Neutral highlight, unread badge |

Every semantic color has a soft variant for backgrounds — 14% alpha of
the base hex.

### 2.5 Color rules

- **Never use more than one accent color in a single component.** The
  accent is a focus device, not decoration.
- **Never use red for informational-only content.** Red is reserved for
  destructive or error states.
- **Status color must match the domain status**, never the UI
  designer's mood. See §6.

---

## 3. Typography

One typeface, one monospace. No display font.

- **Sans:** `Inter`, with system stack fallback (`system-ui,
  -apple-system, "Segoe UI", Roboto, sans-serif`).
- **Mono:** `JetBrains Mono`, fallback `ui-monospace, "SF Mono", Menlo,
  Consolas, monospace`.

### 3.1 Scale

| Style | Size / line-height | Weight | Letter-spacing | Use |
|---|---|---|---|---|
| `display` | 28 / 36 | 600 | -0.02em | Page titles (Dashboard only) |
| `h1` | 22 / 28 | 600 | -0.01em | Section titles, drawer headers |
| `h2` | 18 / 24 | 600 | 0 | Sub-sections |
| `body` | 14 / 20 | 400 | 0 | Default body, table cells |
| `body-strong` | 14 / 20 | 600 | 0 | Table emphasis, KPI numbers |
| `label` | 12 / 16 | 500 | 0.02em uppercase | Form labels, table headers |
| `caption` | 12 / 16 | 400 | 0 | Timestamps, helper text, meta |
| `mono-sm` | 13 / 18 | 500 | 0 | Phone numbers, order IDs, SKUs, referral codes |

### 3.2 Typography rules

- **IDs and phones always render in `mono-sm`.** Never in proportional
  font. Applies to order numbers (`#CDA-412`), phones (`+5541...`),
  SKUs, referral codes, correlation IDs.
- **Numbers in tables use tabular-nums** (`font-variant-numeric:
  tabular-nums`) so columns align.
- **Never use ALL CAPS for body text.** Only `label` may be uppercased.

---

## 4. Spacing & layout

Base unit **4px**. Spacing scale is a strict multiplier — no off-scale
values.

| Name | Value |
|---|---|
| `space-0` | 0 |
| `space-1` | 4px |
| `space-2` | 8px |
| `space-3` | 12px |
| `space-4` | 16px |
| `space-5` | 20px |
| `space-6` | 24px |
| `space-8` | 32px |
| `space-10` | 40px |
| `space-12` | 48px |
| `space-16` | 64px |

### 4.1 Radius

| Name | Value | Use |
|---|---|---|
| `radius-sm` | 4px | Badges, chips |
| `radius-md` | 8px | Inputs, buttons, cards |
| `radius-lg` | 12px | Drawers, modals, panels |
| `radius-full` | 9999px | Avatars, toggle pills |

### 4.2 Breakpoints

| Name | Min width |
|---|---|
| `mobile` | 0 |
| `tablet` | 768px |
| `desktop` | 1024px |
| `wide` | 1440px |

### 4.3 Layout rules

- **Side nav is persistent on `desktop`+**, collapsed into a sheet on
  `mobile`/`tablet`.
- **Content column max-width is 1280px** on `wide`; below that, full
  width.
- **Sticky table header** is mandatory for tables with more than 10
  rows.
- **Minimum touch target 44×44px** on mobile. Never compress row height
  below 44px on touch devices.

---

## 5. Components

Every component has a canonical implementation in
`services/admin/views/partials/`. Consumers reference the partial —
never re-implement visuals.

### 5.1 Button

Three variants, two sizes.

| Variant | Background | Text | Border | Use |
|---|---|---|---|---|
| `primary` | `--accent` | `--text-on-accent` | none | One per view — the main action |
| `secondary` | `transparent` | `--text` | 1px `--border` | All other actions |
| `danger` | `transparent` | `--danger` | 1px `--danger` | Destructive actions only |

Sizes: `md` (height 36, padding-x `space-4`) default; `sm` (height 28,
padding-x `space-3`) for inline table actions.

States: hover lightens background by 6%; focus adds 2px outline in
`--accent` offset by 2px; disabled drops opacity to 50% and blocks
pointer events.

### 5.2 Table

- Row height **48px desktop**, **56px mobile**.
- Zebra striping OFF. Use `--border` dividers at 1px.
- Header row: `--surface-2`, `label` style, sticky.
- Hovered row: `--surface-2`.
- Selected row: `--accent-soft` background + 2px left border in `--accent`.
- Sort controls: arrow icon right-aligned in header cell.
- Pagination: bottom-right, shows `1–20 of 412 · <prev> <next>`.
- Empty state: centered `empty.ejs` partial (see 5.7).
- Loading state: 5 skeleton rows (see 5.7).

### 5.3 Drawer

Right side, 480px wide on desktop, full-screen on mobile. Animates in
160ms ease-out.

- Header: 56px tall, title in `h1`, close button right.
- Body: scrollable, padding `space-6`.
- Footer (optional): sticky bottom, `--surface-2` background, contains
  primary action + cancel.
- Overlay uses `--overlay`.
- `Esc` closes.

### 5.4 Form field

Vertical layout: label on top, input below, help or error under input.

- Label: `label` style, `space-2` below.
- Input height: 36px, `--surface-3`, 1px `--border`, `radius-md`,
  padding-x `space-3`.
- Focus: border `--accent`, outline 2px `--accent-soft`.
- Error: border `--danger`, error text below in `caption` + `--danger`.
- Help text: `caption` + `--text-muted`.
- Disabled: opacity 50%, pointer events none.

Required fields: asterisk after label in `--danger`. Never hide
required-ness only in placeholder text.

### 5.5 Badge

Status pill. Height 20px, padding-x `space-2`, `label` style (11px on
badge), `radius-sm`.

Variants by semantic color: each uses the soft background and the solid
text color of its token. See §6 for status → badge mapping.

### 5.6 Modal / confirmation

Three confirmation levels — the component must encode which:

1. **Level 1 — inline.** No modal. Reversible. (Editing a price.)
2. **Level 2 — dialog.** Centered modal 400px wide, overlay.
   `h1` title, 1–2 lines of body, `danger` + `secondary` buttons.
   (Cancel an order.)
3. **Level 3 — typed confirmation.** Same dialog, adds an input. Button
   stays disabled until the user types the exact resource name
   (`dead-letters`, `agent`, phone number, etc.). (Purge queue,
   disconnect bridge, reset all sessions.)

Never skip to Level 3 where Level 2 suffices. Never downgrade Level 3
to Level 2 "because the operator is experienced."

### 5.7 Toast & banner

- **Toast:** bottom-right, stacks up to 3, auto-dismiss 4s, dismissible
  by click. Success/error/info variants. Used for per-action feedback.
- **Banner:** sticky top, full width, persistent. Only three reasons:
  bridge disconnected, DLX > 0, OpenRouter key invalid or low balance.
  Never use banner for transient feedback.

### 5.8 Empty / loading / error states

Mandatory for every list and detail view.

- **Empty (`empty.ejs`):** icon, one-sentence headline, optional
  subtext, optional single primary action.
- **Loading (`skeleton.ejs`):** shimmering bars matching row shape. No
  generic spinners.
- **Error (`error.ejs`):** `--danger-soft` background, `--danger` text,
  message from backend, `Retry` button, `Copy technical details` link.

---

## 6. Status semantics

Domain statuses come from the database. The UI must render them
consistently everywhere.

### 6.1 Orders

| DB value | Badge label (pt-BR) | Color |
|---|---|---|
| `pending` | Pendente | `--warning` |
| `confirmed` | Confirmado | `--warning` |
| `paid` | Pago | `--success` |
| `shipped` | Enviado | `--info` |
| `delivered` | Entregue | `--success` |
| `cancelled` | Cancelado | `--danger` |

### 6.2 Customers — `access_status`

| DB value | Badge label | Color |
|---|---|---|
| `active` | Ativo | `--success` |
| `invited` | Convidado | `--info` |
| `blocked` | Bloqueado | `--danger` |

### 6.3 Referrals

| DB value | Badge label | Color |
|---|---|---|
| `pending` | Aguardando | `--warning` |
| `activated` | Ativada | `--info` |
| `rewarded` | Recompensada | `--success` |

### 6.4 Health indicators

| State | Label | Color |
|---|---|---|
| WhatsApp connected | Conectado | `--success` |
| WhatsApp awaiting QR | Aguardando QR | `--warning` |
| WhatsApp disconnected | Desconectado | `--danger` |
| Queue depth ≤ 50 | OK | `--success` |
| Queue depth 51–200 | Acumulando | `--warning` |
| Queue depth > 200 **or** DLX > 0 | Crítico | `--danger` |

---

## 7. Depth & elevation

Four levels. Shadows are **only** on floating surfaces — never on
tables, inputs, or inline elements.

| Level | Shadow | Use |
|---|---|---|
| `elev-0` | none | Default surface |
| `elev-1` | `0 1px 2px rgba(0,0,0,0.24)` | Cards that lift on hover |
| `elev-2` | `0 4px 12px rgba(0,0,0,0.32)` | Dropdowns, popovers |
| `elev-3` | `0 12px 32px rgba(0,0,0,0.40)` | Drawers, modals, sheets |

z-index scale:

| Layer | z |
|---|---|
| base | 0 |
| sticky header / nav | 10 |
| dropdown | 20 |
| drawer | 30 |
| modal | 40 |
| toast | 50 |
| banner | 60 |

---

## 8. Do's & Don'ts

Hard rules. Deviations require a written exception in the PR.

- **Do** render every order ID with `ORDER_PREFIX` applied (from env)
  in `mono-sm`.
- **Do** mask phone numbers everywhere except the customer detail page
  header: `+55 41 ••• 1234`. There is a global toggle in the header to
  reveal, per-session only.
- **Do** reuse `shared/db/*.mjs` repos for every write. The admin never
  writes SQL inline.
- **Do** show the current tenant's `display_name` in the header at all
  times so the operator knows which shop they are administering.
- **Do** keep the primary action button visible without scrolling on
  every screen (sticky footer in drawers, top-right on list pages).

- **Don't** invent new colors outside the tokens in §2. If a value is
  missing, add it to `DESIGN.md` first, then use it.
- **Don't** use emoji in the UI chrome. Emoji are only allowed inside
  quoted bot messages (where they match the bot's own replies).
- **Don't** show raw JSON to the operator. Parse `preferences`, `tags`,
  and `items` into chip lists or readable rows. Advanced JSON editor is
  opt-in, behind a "Editar como JSON" toggle.
- **Don't** show toast for a Level 2 or Level 3 confirmed action — use
  an inline success state on the affected row instead. Toasts are for
  actions with no other visible result.
- **Don't** block the UI on long-running operations. Seed catalog,
  reconnect bridge, and queue purge all return an optimistic ack and
  surface progress via a banner.
- **Don't** show the `.env` values in plaintext. Secrets render as
  `••••1234` (last 4 chars) and are read-only.
- **Don't** display Portuguese and English labels side-by-side. Pick
  pt-BR for operator copy and keep it.
- **Don't** rely on color alone to convey status. Every badge pairs
  color with the pt-BR label from §6.
