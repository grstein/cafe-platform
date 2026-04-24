# Configuration & Customization Reference

Reference documentation for every knob in the platform. Each page is
scoped to one surface and can be read in isolation.

**Load on demand** — this is an index, not an overview. Follow the link
that matches your question.

## Configuration files and DB

| Doc | Read when you need to… |
|-----|------------------------|
| [env-vars.md](./env-vars.md) | Check or change an environment variable (`.env`). |
| [app-config.md](./app-config.md) | Change a runtime knob stored in `app_config` (LLM model, humanize delays, PIX toggle, session TTL, `available_models`). |
| [pi-config.md](./pi-config.md) | Understand the `pi-config/` directory layout and when each file is read. |
| [agents-md.md](./agents-md.md) | Customize the agent's persona, business context, or tool-usage rules in `AGENTS.md`. |
| [models.md](./models.md) | Add/remove LLM models, change provider settings, or tune thinking/compaction. |
| [skills.md](./skills.md) | Add a Pi SDK skill, prompt template, or extension. |
| [products.md](./products.md) | Seed or update the product catalog. |
| [allowlist.md](./allowlist.md) | Configure who can message the bot and how referral codes work. |

## Operational reference

| Doc | Read when you need to… |
|-----|------------------------|
| [../reference/commands.md](../reference/commands.md) | Look up or add a static `/command`. |
| [../reference/tools.md](../reference/tools.md) | Look up or add a Pi Agent tool. |
| [../reference/database.md](../reference/database.md) | Understand a table schema or a status transition. |
| [../reference/rabbitmq.md](../reference/rabbitmq.md) | Inspect queues, debug DLQ, or add a routing key. |
| [../reference/setup-scripts.md](../reference/setup-scripts.md) | Re-run a setup script and know what it overwrites. |

## Existing docs

Not part of this reference, but related:

- [../../README.md](../../README.md) — quickstart and deployment.
- [../../CLAUDE.md](../../CLAUDE.md) — architecture overview and AI-agent
  working instructions.
- [../../DESIGN.md](../../DESIGN.md) — visual design system (admin UI).
- [../admin-ui.md](../admin-ui.md) — admin UI functional spec.
