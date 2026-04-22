/**
 * @fileoverview Sender Consumer — sends responses back to WhatsApp.
 *
 * Reads from: sender.response (msg.flow response)
 *             sender.outgoing (msg.flow outgoing)
 * Publishes to: events completed
 *               events (analytics via # binding)
 */

import { connect, publish, consume, ack, nack } from "../shared/lib/rabbitmq.mjs";
import { parseFromRabbitMQ } from "../shared/lib/envelope.mjs";
import { loadConfig, getConfig } from "../shared/lib/config.mjs";
import { getDB, initDB } from "../shared/db/connection.mjs";

const RABBITMQ_URI = process.env.RABBITMQ_URI;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function sendWithHumanization(channel, phone, text, config) {
  const min = config.behavior?.humanize_delay_min_ms || 2000;
  const max = config.behavior?.humanize_delay_max_ms || 6000;
  const delay = randomDelay(min, max);

  if (config.behavior?.typing_indicator !== false) {
    publish(channel, "msg.flow", "send", { phone, action: "presence", state: "composing" });
  }

  await sleep(delay);
  publish(channel, "msg.flow", "send", { phone, action: "text", text });
}

async function handleMessage(channel, msg, config) {
  if (!msg) return;
  try {
    const envelope = parseFromRabbitMQ(msg);
    const { phone } = envelope;
    const cmdResult = envelope.metadata?.command_result;
    const responseMessages = envelope.payload?.response_messages;
    const responseText = envelope.payload?.response_text;

    if (cmdResult?.messages) {
      for (let i = 0; i < cmdResult.messages.length; i++) {
        if (i === 0) await sendWithHumanization(channel, phone, cmdResult.messages[i], config);
        else { await sleep(1000); publish(channel, "msg.flow", "send", { phone, action: "text", text: cmdResult.messages[i] }); }
      }
    } else if (responseMessages && Array.isArray(responseMessages)) {
      for (let i = 0; i < responseMessages.length; i++) {
        if (i === 0) await sendWithHumanization(channel, phone, responseMessages[i], config);
        else { await sleep(1000); publish(channel, "msg.flow", "send", { phone, action: "text", text: responseMessages[i] }); }
      }
    } else if (responseText) {
      await sendWithHumanization(channel, phone, responseText, config);
    } else if (cmdResult?.text) {
      await sendWithHumanization(channel, phone, cmdResult.text, config);
    }

    // Completion event (for aggregator)
    publish(channel, "events", "completed", {
      phone,
      correlation_id: envelope.correlation_id,
      timestamp: new Date().toISOString(),
    });

    // Analytics event
    publish(channel, "events", "analytics", envelope);

    ack(channel, msg);
  } catch (err) {
    console.error("[sender] Error:", err.message);
    nack(channel, msg, !msg.fields.redelivered);
  }
}

async function main() {
  console.log("🟢 Sender consumer starting...");
  await initDB();
  await loadConfig(getDB());
  const { connection, channel } = await connect(RABBITMQ_URI);

  consume(channel, "sender.response", (msg) => handleMessage(channel, msg, getConfig()));
  consume(channel, "sender.outgoing", (msg) => handleMessage(channel, msg, getConfig()));

  console.log("🟢 Sender listening on sender.response + sender.outgoing");
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      console.log(`🔴 Sender shutting down (${sig})`);
      await channel.close(); await connection.close(); process.exit(0);
    });
  }
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
