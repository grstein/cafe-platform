/**
 * @fileoverview Shared helpers for pipeline simulation scripts.
 *
 * These scripts only publish envelopes / observe queues — they never import
 * consumer code. Nothing here touches pi-config or changes broker topology.
 */

import { connect, publish } from "../../shared/lib/rabbitmq.mjs";

const DEFAULT_URI = "amqp://admin:password@localhost:5672/evolution";
const DEFAULT_MGMT = "http://admin:password@localhost:15672";

export function getRabbitUri() {
  return process.env.RABBITMQ_URI || DEFAULT_URI;
}

export function getMgmtBase() {
  return process.env.RABBITMQ_MGMT_URL || DEFAULT_MGMT;
}

export function getVhost() {
  const uri = getRabbitUri();
  const m = uri.match(/\/([^/?]+)(?:\?|$)/);
  return m ? decodeURIComponent(m[1]) : "/";
}

/**
 * Parse simple CLI args in the form --key value or --flag.
 * Coerces numeric-looking values.
 */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      const n = Number(next);
      out[key] = Number.isFinite(n) && next.trim() !== "" ? n : next;
      i++;
    }
  }
  return out;
}

/**
 * Compute a percentile from a numeric array.
 * Uses linear interpolation. Returns NaN for empty arrays.
 */
export function percentile(values, p) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function summarizeLatencies(values) {
  if (!values.length) return { count: 0 };
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    p50: Math.round(percentile(values, 50)),
    p95: Math.round(percentile(values, 95)),
    p99: Math.round(percentile(values, 99)),
  };
}

/**
 * Publish a raw Baileys-shaped "incoming" payload to msg.flow/incoming.
 */
export function publishFakeIncoming(channel, { phone, text, pushName = "LoadSim" }) {
  const payload = {
    instance: process.env.INSTANCE_NAME || "sim",
    data: {
      key: {
        remoteJid: `${phone}@s.whatsapp.net`,
        fromMe: false,
        id: `SIM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
      pushName,
      message: { conversation: text },
      messageType: "conversation",
    },
  };
  publish(channel, "msg.flow", "incoming", payload);
  return payload.data.key.id;
}

/**
 * Listen on events/completed. Calls onCompleted({ phone, correlation_id, timestamp, msg }) for each.
 * Returns a cleanup function.
 */
export async function listenCompleted(uri, onCompleted) {
  const { connection, channel } = await connect(uri);
  const q = await channel.assertQueue("", { exclusive: true, autoDelete: true });
  await channel.bindQueue(q.queue, "events", "completed");
  await channel.consume(q.queue, (msg) => {
    if (!msg) return;
    try {
      const data = JSON.parse(msg.content.toString());
      onCompleted(data, msg);
    } catch {}
    channel.ack(msg);
  });
  return async () => {
    try { await channel.close(); } catch {}
    try { await connection.close(); } catch {}
  };
}

/**
 * Query RabbitMQ management API for queue stats.
 * Requires the management plugin (port 15672). Returns an array of
 * { name, messages, messages_ready, messages_unacknowledged, consumers, ack_rate }.
 */
export async function probeQueues() {
  const base = getMgmtBase();
  const vhost = encodeURIComponent(getVhost());
  const url = `${base}/api/queues/${vhost}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mgmt API ${res.status}: ${await res.text()}`);
  const queues = await res.json();
  return queues.map(q => ({
    name: q.name,
    messages: q.messages || 0,
    messages_ready: q.messages_ready || 0,
    messages_unacknowledged: q.messages_unacknowledged || 0,
    consumers: q.consumers || 0,
    ack_rate: q.message_stats?.ack_details?.rate || 0,
    publish_rate: q.message_stats?.publish_details?.rate || 0,
  }));
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Generate a phone number from a deterministic index.
 */
export function simPhone(index) {
  const base = 5500000090000n;
  return String(base + BigInt(index));
}

export { connect, publish };
