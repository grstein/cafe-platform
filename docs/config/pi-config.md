# `pi-config/` Directory Guide

**Scope**: layout of the `pi-config/` directory mounted at `/config/pi`
inside every container. Index page for the per-file docs below.
**Out of scope**: env vars ([env-vars.md](./env-vars.md)), DB config
([app-config.md](./app-config.md)).

`pi-config/` serves two purposes:

1. **Seed files** — read once on first boot to populate DB tables
   (`app_config`, `allowlist`). After that, the DB is the source of truth.
2. **Pi Agent SDK artifacts** — read by the Pi SDK on every new session
   (`AGENTS.md`, `skills/`, `models.json`, `settings.json`).

## Layout

```
pi-config/
├── config.json       # seed for app_config table (read once → DB)
├── allowlist.txt     # seed for allowlist table (read once → DB)
├── AGENTS.md         # Pi SDK discovers every session
├── models.json       # Pi SDK ModelRegistry (every session)
├── settings.json     # Pi SDK SettingsManager (every session)
├── skills/           # Pi SDK skill discovery (every session)
│   └── <skill-name>/SKILL.md
├── prompts/          # Pi SDK prompt templates (optional)
├── extensions/       # Pi SDK extensions (optional)
└── products.json     # seed for products table (manual, via setup/seed-products.mjs)
```

Start by copying the templates in `examples/pi-config/` to `pi-config/`
(which is gitignored):

```
cp -r examples/pi-config pi-config
```

## Read-once vs per-session

| File | When read | By | Re-apply after edit |
|------|-----------|----|---------------------|
| `config.json` | First consumer boot (if `app_config` empty) | `shared/lib/config.mjs::loadConfig` | `setup/init-config.mjs` + restart consumers |
| `allowlist.txt` | First gateway boot (if `allowlist` empty) | `shared/db/allowlist.mjs::seedFromFile` | `setup/init-config.mjs` (re-inserts patterns) |
| `products.json` | Never automatic | `setup/seed-products.mjs` (manual) | re-run `setup/seed-products.mjs` |
| `AGENTS.md` | Every new Pi SDK session | Pi SDK (walks up from `cwd = CONFIG_DIR`) | Takes effect on next new session (existing cached sessions keep old copy) |
| `models.json` | SDK boot (`ModelRegistry.create`) | `consumers/agent.mjs` | Restart `agent` consumer |
| `settings.json` | SDK boot (`SettingsManager.create`) | `consumers/agent.mjs` | Restart `agent` consumer |
| `skills/*/SKILL.md` | Every new session (frontmatter only; body loaded on demand by agent) | Pi SDK | Takes effect on next new session |

A "new session" is created when there is no cached session for a phone or
the cache has exceeded `session.ttl_minutes`. To force a reload for a
specific user, they can send `/reiniciar`.

## Container mount

In `docker-compose.yml`, `pi-config/` is mounted read-only at
`/config/pi`. Never place writable state (Pi SDK session files, Baileys
auth) here — those belong in `DATA_DIR` (`/data`), a separate writable
volume.

## Per-file references

| File | Doc |
|------|-----|
| `config.json` | [app-config.md](./app-config.md) (covers both the file and the DB it seeds) |
| `allowlist.txt` | [allowlist.md](./allowlist.md) |
| `AGENTS.md` | [agents-md.md](./agents-md.md) |
| `models.json` + `settings.json` | [models.md](./models.md) |
| `skills/`, `prompts/`, `extensions/` | [skills.md](./skills.md) |
| `products.json` | [products.md](./products.md) |

## Related

- [env-vars.md](./env-vars.md) — `CONFIG_DIR` controls where this directory
  is mounted.
- [../reference/setup-scripts.md](../reference/setup-scripts.md) —
  `init-config.mjs` and `seed-products.mjs`.
