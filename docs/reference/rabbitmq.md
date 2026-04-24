# RabbitMQ Topology

**Scope**: exchanges, queues, routing keys, and basic ops.
**Out of scope**: RabbitMQ server tuning, clustering.

Source of truth: `shared/lib/rabbitmq.mjs`, `setup/rabbitmq-init.mjs`.

## Exchanges

| Name | Type | Purpose |
|------|------|---------|
| `msg.flow` | topic | Main pipeline (incoming → outgoing). |
| `events` | topic | Analytics and control events (`completed`, `session_reset`, etc.). |
| `dlx` | fanout | Dead letters from any queue. |

All declared `durable: true`.

## Queues

All queues are `durable: true`. Every non-DLX queue has
`x-dead-letter-exchange: dlx`, so nacked (no-requeue) messages land in
`dead-letters`.

| Queue | Exchange | Routing key | Consumer |
|-------|----------|-------------|----------|
| `gateway.incoming` | `msg.flow` | `incoming` | `consumers/gateway.mjs` |
| `aggregator.validated` | `msg.flow` | `validated` | `consumers/aggregator.mjs` |
| `aggregator.completed` | `events` | `completed` | `consumers/aggregator.mjs` (clears buffer) |
| `enricher.ready` | `msg.flow` | `ready` | `consumers/enricher.mjs` |
| `agent.enriched` | `msg.flow` | `enriched` | `consumers/agent.mjs` |
| `sender.response` | `msg.flow` | `response` | `consumers/sender.mjs` |
| `sender.outgoing` | `msg.flow` | `outgoing` | `consumers/sender.mjs` |
| `analytics.events` | `events` | `#` | `consumers/analytics.mjs` (catches all events) |
| `whatsapp.send` | `msg.flow` | `send` | `services/whatsapp-bridge.mjs` |
| `dead-letters` | `dlx` | `""` | unconsumed — inspect manually |

## Routing keys (pipeline flow)

```
Baileys inbound ──incoming──> gateway
gateway ──validated──> aggregator      (normal message)
gateway ──outgoing────> sender         (command response / denial / welcome)
aggregator ──ready──> enricher
enricher ──enriched──> agent
agent ──response──> sender
sender ──send──> whatsapp-bridge       (payload to Baileys)
sender ──completed──> aggregator       (event)
sender ──analytics:* ─> analytics       (MSG_IN, MSG_OUT, CMD_OUT)
gateway ──session_reset──> agent       (event)
```

## Initialization

```
docker compose exec gateway node setup/rabbitmq-init.mjs
```

Idempotent — `assertExchange` / `assertQueue` are no-ops if the objects
already exist with matching arguments. If you change a queue's
arguments (e.g. DLX), you must delete the queue first.

## Publishing and consuming

`shared/lib/rabbitmq.mjs` exposes:

- `connect(uri) → { connection, channel }`
- `publish(channel, exchange, routingKey, envelope)` — persistent,
  JSON-serialized.
- `consume(channel, queue, handler, { prefetch = 1 })`
- `ack(channel, msg)`, `nack(channel, msg, requeue = false)`

Consumers default to `prefetch: 1` — one message in-flight per consumer
instance.

## Operations

### Inspect queues

```
docker compose exec rabbitmq rabbitmqctl list_queues name messages consumers
```

Management UI is bound to `127.0.0.1:15672` — open with the
`RABBITMQ_USER` / `RABBITMQ_PASSWORD` credentials from `.env`.

### Drain the dead-letter queue

```
docker compose exec rabbitmq rabbitmqadmin -u $RABBITMQ_USER -p $RABBITMQ_PASSWORD \
  --vhost=evolution get queue=dead-letters count=10 ackmode=ack_requeue_false
```

(Each `get` returns up to `count` messages and ACKs them.)

### Replay a dead letter

DLX is fanout — messages arrive in `dead-letters` without the original
routing key. To replay, inspect the envelope, fix the upstream issue,
then re-publish to the original exchange/routing-key.

### Purge a queue (destructive)

```
docker compose exec rabbitmq rabbitmqctl purge_queue <queue-name> --vhost=evolution
```

### Common failure modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `gateway.incoming` growing, no processing | Gateway consumer crash-looping | `docker compose logs gateway`; likely DB connection issue |
| Messages in `dead-letters` | A handler called `nack(channel, msg, false)` — usually after second failure (`msg.fields.redelivered`) | Inspect envelope, fix root cause |
| `whatsapp.send` growing | Bridge disconnected (QR expired) | Visit `http://localhost:3001/qr` and re-scan |
| All queues empty, bot silent | Bridge not publishing `incoming` | `docker compose logs whatsapp-bridge` |

## Envelope shape

Messages on `msg.flow.*` use `shared/lib/envelope.mjs`:

```ts
{
  phone:    string,
  payload:  { messages?, merged_text?, response_text?, … },
  context:  { customer?, app_config?, context_block?, … },
  metadata: { stage, timings, command_result? }
}
```

`incoming` is the raw Baileys payload (not an envelope) — the gateway
parses it and emits envelopes from there on.

## Related

- [setup-scripts.md](./setup-scripts.md) — `rabbitmq-init.mjs`,
  `send-test-message.mjs`.
- [../config/env-vars.md](../config/env-vars.md) — `RABBITMQ_URI`,
  `RABBITMQ_USER`, `RABBITMQ_PASSWORD`.
