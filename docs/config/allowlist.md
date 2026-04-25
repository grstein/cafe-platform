# Allowlist & Referral Gating

**Scope**: how the gateway decides whether to engage a new phone number.
**Out of scope**: static commands ([../reference/commands.md](../reference/commands.md)),
`customers` table schema ([../reference/database.md](../reference/database.md)).

Source of truth: `consumers/gateway.mjs`, `shared/db/allowlist.mjs`,
`shared/db/customers.mjs`, `shared/tools/referral-tools.mjs`.

## Decision flow for every incoming message

```
1. Is phone in allowlist?        → YES → mark customer active, proceed.
2. Is customer already known?    → YES & access_status != "blocked" → proceed.
3. Does message contain a valid
   referral code (REF-XXXX)?     → YES → mark customer invited, welcome, proceed.
4. Otherwise                     → silently drop the message.
```

There is also an **out-of-band entry path**: the bot operator can
authorize a phone via `/admin autorizar <telefone>` from WhatsApp
self-chat. That sets `access_status = 'active'` and stamps
`referred_by_phone = 'admin'` (only when no prior referrer is recorded,
preserving real referral chains). The invitee receives an automatic
welcome message and is instructed to use `/ajuda`. See
[../reference/commands.md#admin--admin-subcommand-args](../reference/commands.md#admin--admin-subcommand-args).

Step 4 logs `Denied <phone> (not in allowlist, no valid code)` but sends
nothing — the goal is to avoid inviting spam replies.

## Allowlist storage

Table `allowlist(pattern TEXT PRIMARY KEY, note TEXT, active BOOLEAN, created_at TIMESTAMPTZ)`.

Loaded in-memory by the gateway with a 60-second TTL cache
(`ALLOWLIST_TTL` in `consumers/gateway.mjs`).

### Pattern syntax

Two forms:

| Pattern | Matches |
|---------|---------|
| `5541999990001` | Exact phone (digits only, include country + area code). |
| `5541*` | Prefix — any phone starting with `5541`. |

Patterns are split into `exact: Set<string>` and `prefixes: string[]` at
load time. A phone matches if it's in `exact` OR `startsWith` any prefix.

The `*` is only meaningful as a trailing suffix — mid-pattern stars are
not treated as wildcards. Other characters (`?`, regex metachars) are
treated literally.

## Seeding from `pi-config/allowlist.txt`

On first `gateway` boot, if the `allowlist` table is empty,
`shared/db/allowlist.mjs::seedFromFile` reads `CONFIG_DIR/allowlist.txt`
and inserts every non-comment line.

File format:

```
# Lines starting with # are comments.
# One pattern per line. Inline comments: 5541999990001 # note

5541999990001
5541999990002
5541*         # all numbers with DDD 41
```

After the first seed the DB is the source of truth. To re-push:

```
docker compose exec gateway node setup/init-config.mjs
```

`init-config.mjs` calls `addPattern()` for each line — which is
`INSERT ... ON CONFLICT DO UPDATE SET active = true`. Lines removed from
the file are **not** deleted from the DB; deactivate them with a direct
SQL update or by calling the repo's `removePattern(pattern)` /
`deletePattern(pattern)`.

## Referral codes

Configured via `REFERRAL_CODE_PREFIX` env var (default `REF-`).

- Every customer gets a code on first contact via
  `customers.ensureReferralCode(phone)`: `<PREFIX><4 chars from A-HJ-NP-Z2-9>`.
  Base32-ish alphabet avoids `I`/`O`/`0`/`1` to prevent typos.
- Gateway's code regex:
  `\b<escaped prefix>[A-HJ-NP-Z2-9]{4}\b` (case-insensitive).
- Sharing a code is how someone outside the allowlist gets in.

### Referral lifecycle

```
referrer sends /indicar       → gets their code + wa.me/<bot_phone>?text=REF-XXXX
invitee messages bot first time
  (message contains REF-XXXX) → gateway validates, upserts customer with
                                 access_status="invited",
                                 referred_by_phone=referrer_phone
invitee sends /confirma on their
  first order                 → referrals.activate(phone) + access_status="active"
                                 referrer earns 10% discount (reward_value)
```

Alternatively, a referrer can call the `invite_customer` tool with a
phone number directly. This pre-creates the invitee's customer row with
`access_status="invited"`, so the invitee can message the bot without
needing to send the code.

## `customers.access_status` values

| Value | Meaning | Who sets it |
|-------|---------|-------------|
| `active` | Full access. | gateway on first contact from allowlisted phone; gateway after first `/confirma` for invited customer. |
| `invited` | Pre-authorized via referral code or `invite_customer` tool. | gateway (code path) or `invite_customer` tool. |
| `blocked` | Denied regardless of allowlist. | Manual admin action (no code path sets this yet). |

`referred_by_phone = 'admin'` is the marker for customers authorized
via `/admin autorizar`. The `referrals` table is **not** touched by
this path (admin is not a real referrer phone) — only the customer row.

Default on `customers` insert: `active`.

## Rate limiting (adjacent concern)

Independent of allowlist, the gateway enforces a per-phone rolling
60-second limit from `app_config.behavior.rate_limit_per_min` (default
`8`), with a hard abuse cap of `20`. Limited messages are silently
dropped.

## Related

- [../reference/commands.md](../reference/commands.md) — `/indicar` command.
- [../reference/tools.md](../reference/tools.md) — `invite_customer`,
  `get_referral_info`.
- [../reference/database.md](../reference/database.md) — `customers`,
  `referrals`, `allowlist` tables.
- [env-vars.md](./env-vars.md) — `REFERRAL_CODE_PREFIX`, `BOT_PHONE`.
