# Pipeline Performance

Reference for simulating load, probing the broker, and reasoning about
throughput bottlenecks in the RabbitMQ pipeline.

## Simulation scripts (`scripts/sim/`)

All scripts only publish envelopes and/or read the RabbitMQ management API.
None of them import consumer code or modify `pi-config/`. They can be run
against any deployment by setting `RABBITMQ_URI` and `RABBITMQ_MGMT_URL`.

| Script | npm alias | Purpose |
|---|---|---|
| `sim-load.mjs`      | `npm run sim:load`       | N msgs across M phones at target rate; reports end-to-end p50/p95/p99 |
| `sim-rapid-fire.mjs`| `npm run sim:rapid`      | Burst of 5 msgs in 400 ms to one phone; verifies aggregator merges to one `completed` |
| `sim-resilience.mjs`| `npm run sim:resilience` | Restarts a target consumer mid-load (`--target enricher|agent|...`); asserts no loss |
| `probe-queues.mjs`  | `npm run sim:probe`      | Polls `/api/queues` every 2 s; prints depth + consumer + rates |
| `bench-report.mjs`  | `npm run sim:bench`      | Orchestrates `sim-load` + `probe`, emits a markdown report under `docs/reference/performance-runs/` |

### Typical workflow

```bash
# 1. Make sure infra + consumers are up
docker compose up -d

# 2. Initialize topology (once)
docker compose exec gateway node setup/rabbitmq-init.mjs

# 3. In terminal A — watch queue depth
npm run sim:probe

# 4. In terminal B — push load and get a report
npm run sim:bench -- --label baseline --messages 100 --phones 10 --rate 10
```

Compare baseline vs post-optimization reports by diffing the two files under
`docs/reference/performance-runs/`.

## Per-stage latency: `PIPELINE_TIMING` events

`setStage()` in `shared/lib/envelope.mjs` records an ISO timestamp on every
stage transition in `envelope.metadata.timings`. The analytics consumer
(`consumers/analytics.mjs`) extracts stage-to-stage deltas once per message
and logs them as `PIPELINE_TIMING` events into the JSONL log file
(`LOG_DIR/<date>.jsonl`):

```json
{
  "ts": "2026-04-24T12:00:00.000Z",
  "type": "PIPELINE_TIMING",
  "phone": "5500000090000",
  "stage": "response",
  "end_to_end_ms": 7340,
  "stages_ms": {
    "incoming_to_validated": 12,
    "validated_to_ready": 2510,
    "ready_to_enriched": 38,
    "enriched_to_response": 4780
  },
  "is_command": false,
  "batch_count": 1,
  "correlation_id": "..."
}
```

To aggregate:

```bash
jq -s '[.[] | select(.type=="PIPELINE_TIMING")] |
       { count: length,
         avg_e2e: (map(.end_to_end_ms) | add / length),
         avg_ready_to_enriched: (map(.stages_ms.ready_to_enriched) | add / length) }' \
  $LOG_DIR/$(date -I).jsonl
```

The `validated_to_ready` delta normally includes the aggregator debounce
window (~2.5 s). `enriched_to_response` is dominated by the LLM call.

## Tuning

### Prefetch (`PREFETCH` env)

`shared/lib/rabbitmq.mjs`'s `consume()` accepts a prefetch option; each
consumer reads `process.env.PREFETCH` with a safe default:

| Consumer | Default | Rationale |
|---|---|---|
| `gateway`    | 8  | Stateless per message; rate-limit map is per-phone, independent |
| `enricher`   | 8  | Independent DB reads per message |
| `sender`     | 8  | `sleep` for humanization no longer blocks other phones |
| `analytics`  | 16 | Idempotent logs + upserts |
| `aggregator` | 1  | In-memory state per phone; a single consumer must own all the state |
| `agent`      | 1  | Pi `AgentSession` cache is per-process, and the aggregator already enforces one in-flight per phone |

Override at deploy time:

```yaml
# docker-compose.yml (excerpt)
gateway:
  environment:
    PREFETCH: "16"
```

### Horizontal scaling

- `gateway`, `enricher`, `sender`, `analytics` are stateless between
  messages and can be scaled to N replicas.
- `aggregator` must remain a single replica (in-memory per-phone state).
- `agent` can be scaled, but the per-phone session cache is process-local —
  cache hit rate falls as replicas grow. Pin phones to a replica with a
  consistent-hash routing key if horizontal scale of the agent is needed.

## Known bottlenecks

| Stage | Cost | Notes |
|---|---|---|
| `agent` (LLM) | 3–30 s per message | Dominant; `/modelo` lets clients pick faster models |
| `aggregator` debounce | 2.5 s (configurable: `session.debounce_ms`) | Intentional; lowers LLM cost |
| `sender` humanize | 2–6 s | Intentional; `behavior.humanize_delay_*_ms` in app_config |
| `enricher` | 5 DB reads | Parallelized via `Promise.all` |

## Follow-ups (not implemented yet)

- **Publisher confirms** — `shared/lib/rabbitmq.mjs:publish` is fire-and-forget
  (`persistent: true` only). Adding `channel.confirmSelect()` + `waitForConfirms()`
  would close the silent-loss window around broker crashes.
- **DLQ processor** — messages land in `dead-letters` but no alert/replay
  exists today.
- **Shared rate-limit / allowlist cache** — currently in-memory per gateway
  process; leaks when the gateway is scaled horizontally. A Redis-backed
  store would fix it.
- **Per-phone consistent-hash routing** for the agent — required before
  scaling the agent consumer to >1 replica.

## Related

- [rabbitmq.md](./rabbitmq.md) — topology, queues, DLQ operations.
- [../config/env-vars.md](../config/env-vars.md) — `RABBITMQ_URI`, `PREFETCH`, `LOG_DIR`.
- [setup-scripts.md](./setup-scripts.md) — `send-test-message.mjs`.
