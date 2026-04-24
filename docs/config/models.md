# `pi-config/models.json` and `settings.json`

**Scope**: Pi Agent SDK model/provider registry and SDK settings.
**Out of scope**: `available_models` in `app_config`
([app-config.md](./app-config.md)) — that's a *UI-facing* list; this file
is the *provider-facing* registry.

Source of truth: `examples/pi-config/models.json`, `settings.json`, and
`consumers/agent.mjs` (where `ModelRegistry` and `SettingsManager` are
created).

## `models.json`

Defines providers and the models they expose. The Pi SDK's
`ModelRegistry.create(authStorage, "<CONFIG_DIR>/models.json")` reads this
file once at consumer boot.

### Shape

```json
{
  "providers": {
    "<provider-key>": {
      "envVar":  "<env var holding the API key>",
      "baseUrl": "<provider base URL>",
      "models": [
        {
          "id":                      "<model id>",
          "name":                    "<human-readable name>",
          "reasoning":               true,
          "supportsReasoningEffort": true
        }
      ]
    }
  }
}
```

### Fields

| Field | Required | Purpose |
|-------|----------|---------|
| `providers.<key>` | yes | Provider key. Must match `app_config.llm.provider` (default `"openrouter"`). |
| `providers.<key>.envVar` | yes | Name of the env var the SDK reads for the API key. For OpenRouter, set `OPENROUTER_API_KEY`. |
| `providers.<key>.baseUrl` | yes | Provider base URL. For OpenRouter: `https://openrouter.ai/api/v1`. |
| `providers.<key>.models[].id` | yes | Canonical model ID (`anthropic/claude-haiku-4.5`, etc). Must match `app_config.llm.model` and any `available_models[].id`. |
| `providers.<key>.models[].name` | yes | Display name. |
| `providers.<key>.models[].reasoning` | no | Hint that the model supports reasoning. |
| `providers.<key>.models[].supportsReasoningEffort` | no | Hint that `thinking` levels are honored. |

### Adding a model

1. Add the entry under `providers.openrouter.models`.
2. If you want users to be able to pick it via `/modelo`, also add it to
   `app_config.available_models` in `config.json` and re-seed:
   `docker compose exec gateway node setup/init-config.mjs`.
3. Restart the `agent` consumer.

Models not present here cause
`modelRegistry.find("openrouter", id)` to return `null`; the agent falls
back to `app_config.llm.model` and logs a warning.

### Adding a new provider

Only OpenRouter is wired in `consumers/agent.mjs` today
(`modelRegistry.find("openrouter", ...)`). To use another provider you
must also extend the `resolveModel()` logic in `agent.mjs`.

## `settings.json`

SDK-level settings loaded via
`SettingsManager.create(CONFIG_DIR, CONFIG_DIR)`.

### Shape

```json
{
  "defaultThinkingLevel": "medium",
  "compaction": {
    "enabled":   true,
    "threshold": 0.8
  }
}
```

### Fields

| Field | Default | Purpose |
|-------|---------|---------|
| `defaultThinkingLevel` | `"medium"` | Fallback thinking level when `app_config.llm.thinking` is not set. Values: `"off"`, `"low"`, `"medium"`, `"high"`. `app_config.llm.thinking` takes precedence. |
| `compaction.enabled` | `true` | Whether the SDK compacts long conversations to stay within context. |
| `compaction.threshold` | `0.8` | Fraction of context window at which compaction kicks in. |

Changes require an `agent` consumer restart.

## How the pieces interact

```
User sends /modelo 2
   ↓
gateway resolves app_config.available_models[1].id
   ↓
customer.preferences.modelo = "<model id>"
   ↓
agent consumer reads preferences on next message
   ↓
modelRegistry.find("openrouter", id)  ← reads models.json
   ↓
createAgentSession({ model, thinking })
```

Three files must agree on the model ID:

- `pi-config/models.json` — the provider actually has this model.
- `pi-config/config.json → available_models[].id` — exposed via `/modelo`.
- `pi-config/config.json → llm.model` — the default.

## Related

- [app-config.md](./app-config.md) — `llm.*`, `available_models`.
- [../reference/commands.md](../reference/commands.md) — `/modelo` command.
- [env-vars.md](./env-vars.md) — `OPENROUTER_API_KEY`.
