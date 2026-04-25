import { randomUUID } from "crypto";

export function createEnvelope({ phone, channel = "whatsapp", text, pushName, actor = "customer" }) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    correlation_id: randomUUID(),
    phone,
    channel,
    timestamp: now,
    payload: {
      messages: [{ text, ts: now, pushName: pushName || null }],
      merged_text: text,
      is_batch: false,
      batch_count: 1,
      response_text: null,
      response_messages: null,
    },
    context: {},
    metadata: { stage: "incoming", attempt: 1, source: "whatsapp", timings: {}, command_result: null, actor },
  };
}

export function addMessage(envelope, { text, ts, pushName }) {
  envelope.payload.messages.push({ text, ts: ts || new Date().toISOString(), pushName: pushName || null });
  envelope.payload.merged_text = envelope.payload.messages.map(m => m.text).join("\n");
  envelope.payload.batch_count = envelope.payload.messages.length;
  envelope.payload.is_batch = envelope.payload.batch_count > 1;
  return envelope;
}

export function setStage(envelope, stage) {
  const prev = envelope.metadata.stage;
  envelope.metadata.stage = stage;
  envelope.metadata.timings[`${prev}_to_${stage}`] = new Date().toISOString();
  return envelope;
}

export function enrichContext(envelope, key, value) {
  envelope.context[key] = value;
  return envelope;
}

export function setResponse(envelope, text, messages = null) {
  envelope.payload.response_text = text;
  envelope.payload.response_messages = messages;
  return envelope;
}

export function parseFromRabbitMQ(msg) {
  return JSON.parse(msg.content.toString());
}
