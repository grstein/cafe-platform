# `pi-config/skills/`, `prompts/`, `extensions/`

**Scope**: Pi Agent SDK skill/prompt/extension discovery.
**Out of scope**: `AGENTS.md` ([agents-md.md](./agents-md.md)), tool
definitions ([../reference/tools.md](../reference/tools.md)).

Source of truth: the Pi Agent SDK skill discovery rules and
`examples/pi-config/skills/example-skill/SKILL.md`.

## Skills

### What they are

A skill is a folder under `pi-config/skills/<name>/` containing a
`SKILL.md` file with frontmatter. Unlike `AGENTS.md` (always injected in
full), only the skill's **frontmatter** is injected into the system prompt
at session start. The body is loaded on demand when the agent decides to
consult the skill.

This matters for token budgets — you can keep many detailed playbooks
available without blowing up every request.

### File layout

```
pi-config/skills/
  <skill-name>/
    SKILL.md                # frontmatter + body
    <supporting-files>.md   # optional — loaded if referenced from SKILL.md
```

### `SKILL.md` format

```markdown
---
name: skill-name
description: One-line description the agent sees in every session.
---

# Human-readable title

Body. Only loaded when the agent opens this skill.
```

Required frontmatter:

| Field | Purpose |
|-------|---------|
| `name` | Stable identifier. Match the folder name. |
| `description` | One sentence shown to the agent in every session. Write it so the agent knows *when* to open the skill. |

### When to prefer a skill over `AGENTS.md` content

- The procedure is long (>10 lines).
- It only applies in specific situations (B2B orders, complaint handling,
  rare edge cases).
- It has step-by-step detail the agent only needs occasionally.

Good candidates: complaint triage scripts, wholesale/B2B handling, style
guides for delicate conversations, troubleshooting playbooks.

### When to prefer a tool over a skill

- The procedure needs to read or write DB state.
- The output must be structured (not free text).
- The procedure is deterministic and can be implemented in code.

See [../reference/tools.md](../reference/tools.md) for how to add a tool.

### When it's read

Skill frontmatter is scanned every time a new Pi SDK session is created
(same cadence as `AGENTS.md` — see [pi-config.md](./pi-config.md)). Bodies
are read on demand during a session.

### Adding a skill

1. `mkdir pi-config/skills/<skill-name>`
2. Create `SKILL.md` with the frontmatter above.
3. Restart the `agent` consumer (or wait for session cache expiry).

The system runs fine with zero skills — they are purely additive.

## Prompts

Directory: `pi-config/prompts/`.

Pi SDK prompt templates. The reference template ships empty. If your Pi
SDK deployment uses prompt templates, place them here; they are discovered
by the SDK at the same cadence as skills.

## Extensions

Directory: `pi-config/extensions/`.

Pi SDK extension discovery root. Also empty in the template. Consult Pi
SDK documentation for extension format; the platform does not impose
additional conventions here.

## Related

- [agents-md.md](./agents-md.md) — for global, always-loaded instructions.
- [../reference/tools.md](../reference/tools.md) — for code-backed
  operations.
- [pi-config.md](./pi-config.md) — discovery cadence reference.
