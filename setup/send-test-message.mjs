#!/usr/bin/env node
/**
 * Send a test message into the pipeline without WhatsApp.
 *
 * Usage:
 *   node setup/send-test-message.mjs "Hello"
 *   node setup/send-test-message.mjs "Hello" --phone 5500000000001
 *   node setup/send-test-message.mjs "/ajuda"
 *   node setup/send-test-message.mjs "Hi" --stage validated     # skip gateway
 *   node setup/send-test-message.mjs --listen                   # monitor responses
 */

import { connect, publish } from "../shared/lib/rabbitmq.mjs";
import { createEnvelope, setStage } from "../shared/lib/envelope.mjs";

const args = process.argv.slice(2);

const listenMode = args.includes("--listen");
const phoneIdx = args.indexOf("--phone");
const stageIdx = args.indexOf("--stage");
const nameIdx = args.indexOf("--name");

const phone = phoneIdx !== -1 ? args[phoneIdx + 1] : "5500000000001";
const stage = stageIdx !== -1 ? args[stageIdx + 1] : "incoming";
const pushName = nameIdx !== -1 ? args[nameIdx + 1] : "Test User";
const text = args.find((a, i) => {
  if (a.startsWith("--")) return false;
  const prev = args[i - 1];
  return prev === undefined || !prev.startsWith("--");
});

const uri = process.env.RABBITMQ_URI || "amqp://admin:password@localhost:5672/evolution";

async function sendMessage() {
  const { connection, channel } = await connect(uri);

  if (stage === "incoming") {
    const payload = {
      instance: process.env.INSTANCE_NAME || "demo",
      data: {
        key: {
          remoteJid: `${phone}@s.whatsapp.net`,
          fromMe: false,
          id: `TEST-${Date.now()}`,
        },
        pushName,
        message: { conversation: text },
        messageType: "conversation",
      },
    };
    publish(channel, "msg.flow", "incoming", payload);
    console.log(`📤 Sent to gateway.incoming`);
  } else {
    const envelope = createEnvelope({ phone, channel: "whatsapp", text, pushName });
    setStage(envelope, stage);
    publish(channel, "msg.flow", stage, envelope);
    console.log(`📤 Sent to msg.flow ${stage}`);
  }

  console.log(`   Phone: ${phone}`);
  console.log(`   Text:  "${text}"`);
  console.log(`   Stage: ${stage}`);

  await channel.close();
  await connection.close();
}

async function listen() {
  console.log(`👂 Listening for pipeline output...`);
  console.log(`   Press Ctrl+C to stop\n`);

  const { connection, channel } = await connect(uri);

  const q1 = await channel.assertQueue("", { exclusive: true, autoDelete: true });
  await channel.bindQueue(q1.queue, "events", "#");

  const q2 = await channel.assertQueue("", { exclusive: true, autoDelete: true });
  await channel.bindQueue(q2.queue, "msg.flow", "outgoing");

  const q3 = await channel.assertQueue("", { exclusive: true, autoDelete: true });
  await channel.bindQueue(q3.queue, "msg.flow", "response");

  channel.consume(q1.queue, (msg) => {
    if (!msg) return;
    const data = JSON.parse(msg.content.toString());
    console.log(`📥 [events] ${msg.fields.routingKey}`);
    if (data.payload?.response_text) console.log(`   Response: "${data.payload.response_text.substring(0, 200)}"`);
    if (data.phone) console.log(`   Phone: ${data.phone}`);
    console.log();
    channel.ack(msg);
  }, { noAck: false });

  channel.consume(q2.queue, (msg) => {
    if (!msg) return;
    const data = JSON.parse(msg.content.toString());
    const cmd = data.metadata?.command_result;
    console.log(`📥 [outgoing]`);
    if (cmd) console.log(`   Command: ${cmd.command}`);
    if (data.payload?.response_text) console.log(`   Response: "${data.payload.response_text.substring(0, 200)}"`);
    console.log();
    channel.ack(msg);
  }, { noAck: false });

  channel.consume(q3.queue, (msg) => {
    if (!msg) return;
    const data = JSON.parse(msg.content.toString());
    console.log(`📥 [response]`);
    if (data.payload?.response_text) console.log(`   Response: "${data.payload.response_text.substring(0, 300)}"`);
    console.log();
    channel.ack(msg);
  }, { noAck: false });

  process.on("SIGINT", async () => {
    await channel.close();
    await connection.close();
    process.exit(0);
  });
}

if (listenMode) {
  listen().catch(err => { console.error("Error:", err.message); process.exit(1); });
} else if (!text) {
  console.log(`Usage:
  node setup/send-test-message.mjs "Hello"
  node setup/send-test-message.mjs "Hello" --phone 5500000000001
  node setup/send-test-message.mjs "/ajuda"
  node setup/send-test-message.mjs "Oi" --stage validated
  node setup/send-test-message.mjs --listen`);
  process.exit(1);
} else {
  sendMessage().catch(err => { console.error("Error:", err.message); process.exit(1); });
}
