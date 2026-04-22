import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createMockChannel } from "../../helpers/rabbitmq.mjs";
import { PHONES, ENVELOPE } from "../../helpers/fixtures.mjs";
import { createEnvelope, addMessage, setStage } from "../../../shared/lib/envelope.mjs";

// Replicate aggregator state machine for testing
const phoneState = new Map();

function flush(channel, phone) {
  const state = phoneState.get(phone);
  if (!state) return;
  state.inFlight = true;
  state.timer = null;
  setStage(state.envelope, "ready");
  channel.publish("msg.flow", "ready", Buffer.from(JSON.stringify(state.envelope)));
}

function startDebounce(channel, phone, ms) {
  const state = phoneState.get(phone);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => flush(channel, phone), ms);
}

function handleValidated(channel, envelope, debounceMs = 100) {
  const phone = envelope.phone;
  const existing = phoneState.get(phone);
  if (!existing) {
    phoneState.set(phone, { envelope, timer: null, inFlight: false, buffer: [] });
    startDebounce(channel, phone, debounceMs);
  } else if (!existing.inFlight) {
    const lastMsg = envelope.payload.messages[0];
    addMessage(existing.envelope, lastMsg);
    startDebounce(channel, phone, debounceMs);
  } else {
    existing.buffer.push(envelope.payload.messages[0]);
  }
}

function handleCompletion(phone) {
  const state = phoneState.get(phone);
  if (!state) return;
  state.inFlight = false;
  if (state.buffer.length > 0) {
    const firstBuffered = state.buffer.shift();
    const newEnvelope = createEnvelope({
      phone,
      channel: "whatsapp",
      text: firstBuffered.text,
      pushName: firstBuffered.pushName,
    });
    for (const buffered of state.buffer) addMessage(newEnvelope, buffered);
    state.envelope = newEnvelope;
    state.buffer = [];
    return true; // needs new debounce
  }
  phoneState.delete(phone);
  return false;
}

describe("aggregator internals", () => {
  let channel;

  beforeEach(() => {
    channel = createMockChannel();
    phoneState.clear();
  });

  it("single message flushes after debounce", async () => {
    const env = ENVELOPE({ text: "Oi" });
    handleValidated(channel, env, 50);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(channel.published.length, 1);
    assert.ok(channel.published[0].routingKey.includes("ready"));
  });

  it("two messages within debounce window batch together", async () => {
    const env1 = ENVELOPE({ text: "Oi" });
    const env2 = ENVELOPE({ text: "Tudo bem?" });
    handleValidated(channel, env1, 100);
    handleValidated(channel, env2, 100);
    await new Promise(r => setTimeout(r, 200));
    assert.equal(channel.published.length, 1);
    const flushed = channel.published[0].envelope;
    assert.equal(flushed.payload.batch_count, 2);
  });

  it("message during inFlight goes to buffer", () => {
    const env1 = ENVELOPE({ text: "Oi" });
    handleValidated(channel, env1, 999999);
    const state = phoneState.get(PHONES.gustavo);
    state.inFlight = true;
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }

    const env2 = ENVELOPE({ text: "E aí?" });
    handleValidated(channel, env2, 999999);
    assert.equal(state.buffer.length, 1);
    assert.equal(state.buffer[0].text, "E aí?");
  });

  it("completion with empty buffer deletes state", () => {
    phoneState.set(PHONES.gustavo, {
      envelope: ENVELOPE(), timer: null, inFlight: true, buffer: [],
    });
    const restart = handleCompletion(PHONES.gustavo);
    assert.equal(restart, false);
    assert.ok(!phoneState.has(PHONES.gustavo));
  });

  it("completion with buffered messages restarts cycle", () => {
    phoneState.set(PHONES.gustavo, {
      envelope: ENVELOPE(),
      timer: null,
      inFlight: true,
      buffer: [{ text: "buffered msg", pushName: "Alice" }],
    });
    const restart = handleCompletion(PHONES.gustavo);
    assert.equal(restart, true);
    assert.ok(phoneState.has(PHONES.gustavo));
    assert.equal(phoneState.get(PHONES.gustavo).buffer.length, 0);
  });
});
