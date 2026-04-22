/**
 * @fileoverview Aggregator Consumer — message debouncer for rapid-fire WhatsApp.
 *
 * Reads from: aggregator.validated (msg.flow validated)
 *             aggregator.completed (events completed)
 * Publishes to: msg.flow ready
 */

import { connect, publish, consume, ack, nack } from "../shared/lib/rabbitmq.mjs";
import { parseFromRabbitMQ, addMessage, setStage, createEnvelope } from "../shared/lib/envelope.mjs";
import { loadConfig, getConfig } from "../shared/lib/config.mjs";
import { getDB, initDB } from "../shared/db/connection.mjs";

const RABBITMQ_URI = process.env.RABBITMQ_URI;
const DEFAULT_DEBOUNCE_MS = 2500;

/** @type {Map<string, { envelope: object, timer: NodeJS.Timeout|null, inFlight: boolean, buffer: object[] }>} */
const phoneState = new Map();

function flush(channel, phone) {
  const state = phoneState.get(phone);
  if (!state) return;
  state.inFlight = true;
  state.timer = null;
  setStage(state.envelope, "ready");
  publish(channel, "msg.flow", "ready", state.envelope);
}

function startDebounce(channel, phone, ms) {
  const state = phoneState.get(phone);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => flush(channel, phone), ms);
}

async function main() {
  console.log("🟢 Aggregator consumer starting...");
  await initDB();
  await loadConfig(getDB());
  const { connection, channel } = await connect(RABBITMQ_URI);

  consume(channel, "aggregator.validated", async (msg) => {
    if (!msg) return;
    try {
      const envelope = parseFromRabbitMQ(msg);
      const phone = envelope.phone;
      const debounceMs = getConfig().session?.debounce_ms || DEFAULT_DEBOUNCE_MS;
      const existing = phoneState.get(phone);

      if (!existing) {
        phoneState.set(phone, { envelope, timer: null, inFlight: false, buffer: [] });
        startDebounce(channel, phone, debounceMs);
      } else if (!existing.inFlight) {
        addMessage(existing.envelope, envelope.payload.messages[0]);
        startDebounce(channel, phone, debounceMs);
      } else {
        existing.buffer.push(envelope.payload.messages[0]);
      }

      ack(channel, msg);
    } catch (err) {
      console.error("[aggregator] Error (validated):", err.message);
      nack(channel, msg, !msg.fields.redelivered);
    }
  });

  consume(channel, "aggregator.completed", async (msg) => {
    if (!msg) return;
    try {
      const event = parseFromRabbitMQ(msg);
      const { phone } = event;
      const state = phoneState.get(phone);

      if (state) {
        state.inFlight = false;
        if (state.buffer.length > 0) {
          const firstBuffered = state.buffer.shift();
          const newEnvelope = createEnvelope({
            phone,
            text: firstBuffered.text,
            pushName: firstBuffered.pushName,
          });
          for (const buffered of state.buffer) addMessage(newEnvelope, buffered);
          state.envelope = newEnvelope;
          state.buffer = [];
          startDebounce(channel, phone, getConfig().session?.debounce_ms || DEFAULT_DEBOUNCE_MS);
        } else {
          phoneState.delete(phone);
        }
      }

      ack(channel, msg);
    } catch (err) {
      console.error("[aggregator] Error (completed):", err.message);
      ack(channel, msg);
    }
  });

  // Periodic cleanup of stale entries (>30 min)
  setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [phone, state] of phoneState) {
      const ts = new Date(state.envelope.timestamp).getTime();
      if (ts < cutoff) {
        if (state.timer) clearTimeout(state.timer);
        phoneState.delete(phone);
      }
    }
  }, 5 * 60 * 1000);

  console.log("🟢 Aggregator listening on aggregator.validated + aggregator.completed");
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      console.log(`🔴 Aggregator shutting down (${sig})`);
      for (const [, s] of phoneState) { if (s.timer) clearTimeout(s.timer); }
      await channel.close(); await connection.close(); process.exit(0);
    });
  }
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
