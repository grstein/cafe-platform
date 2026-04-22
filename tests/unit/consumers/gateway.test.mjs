import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EVOLUTION_PAYLOAD, PHONES } from "../../helpers/fixtures.mjs";

// Copy pure functions from gateway.mjs for testing
function parseIncomingPayload(raw) {
  const d = raw.data || raw;
  const key = d.key || {};
  if (key.fromMe) return null;
  const jid = key.remoteJid || "";
  if (jid.includes("@g.us") || jid.includes("@broadcast")) return null;
  const phone = jid.replace("@s.whatsapp.net", "");
  if (!phone) return null;
  const msg = d.message || {};
  const text = msg.conversation || msg.extendedTextMessage?.text || "";
  if (!text.trim()) return null;
  return { phone, text: text.trim(), pushName: d.pushName || "" };
}

const rateLimits = new Map();
function checkRateLimit(phone, limit = 8) {
  const now = Date.now();
  let entry = rateLimits.get(phone);
  if (!entry || now - entry.windowStart > 60000) { entry = { count: 0, windowStart: now }; rateLimits.set(phone, entry); }
  entry.count++;
  if (entry.count > 20) return "abuse";
  if (entry.count > limit) return "limited";
  return "ok";
}

function isAllowlisted(phone, allowlist) {
  if (allowlist.exact.has(phone)) return true;
  return allowlist.prefixes.some(p => phone.startsWith(p));
}

function handleCommandAndPublish(channel, phone, cmdResult) {
  const published = [];
  const mockChannel = {
    publish(exchange, routingKey, buffer) {
      published.push({ exchange, routingKey, data: JSON.parse(buffer.toString()) });
    },
  };
  if (cmdResult) {
    mockChannel.publish("msg.flow", "outgoing", Buffer.from(JSON.stringify({ phone })));
    if (cmdResult.resetSession) {
      mockChannel.publish("events", "session_reset", Buffer.from(JSON.stringify({ phone })));
    }
  }
  return published;
}

describe("gateway session reset", () => {
  it("publishes session_reset event when command returns resetSession", () => {
    const cmdResult = { command: "reiniciar", text: "Conversa reiniciada!", resetSession: true };
    const published = handleCommandAndPublish(null, PHONES.gustavo, cmdResult);
    assert.equal(published.length, 2);
    assert.equal(published[1].exchange, "events");
    assert.equal(published[1].routingKey, "session_reset");
    assert.equal(published[1].data.phone, PHONES.gustavo);
  });

  it("does not publish session_reset for normal commands", () => {
    const cmdResult = { command: "ajuda", text: "help text" };
    const published = handleCommandAndPublish(null, PHONES.gustavo, cmdResult);
    assert.equal(published.length, 1);
    assert.equal(published[0].exchange, "msg.flow");
    assert.equal(published[0].routingKey, "outgoing");
  });

  it("publishes session_reset when /modelo changes model", () => {
    const cmdResult = { command: "modelo", text: "Modelo alterado...", resetSession: true };
    const published = handleCommandAndPublish(null, PHONES.gustavo, cmdResult);
    const resetEvent = published.find(p => p.routingKey === "session_reset");
    assert.ok(resetEvent);
    assert.equal(resetEvent.data.phone, PHONES.gustavo);
  });
});

describe("gateway internals", () => {
  beforeEach(() => rateLimits.clear());

  it("parseIncomingPayload extracts phone and text", () => {
    const r = parseIncomingPayload(EVOLUTION_PAYLOAD("Oi!", PHONES.gustavo));
    assert.equal(r.phone, PHONES.gustavo);
    assert.equal(r.text, "Oi!");
    assert.equal(r.pushName, "Customer");
  });

  it("parseIncomingPayload returns null for fromMe", () => {
    assert.equal(parseIncomingPayload(EVOLUTION_PAYLOAD("x", "55", { fromMe: true })), null);
  });

  it("parseIncomingPayload returns null for group", () => {
    const payload = { instance: "T", data: { key: { remoteJid: "123@g.us", fromMe: false }, message: { conversation: "hi" } } };
    assert.equal(parseIncomingPayload(payload), null);
  });

  it("parseIncomingPayload returns null for empty text", () => {
    const payload = { instance: "T", data: { key: { remoteJid: "55@s.whatsapp.net", fromMe: false }, message: {} } };
    assert.equal(parseIncomingPayload(payload), null);
  });

  it("checkRateLimit ok within limit", () => {
    assert.equal(checkRateLimit("55", 8), "ok");
  });

  it("checkRateLimit limited above 8", () => {
    for (let i = 0; i < 8; i++) checkRateLimit("55", 8);
    assert.equal(checkRateLimit("55", 8), "limited");
  });

  it("checkRateLimit abuse above 20", () => {
    for (let i = 0; i < 20; i++) checkRateLimit("55", 8);
    assert.equal(checkRateLimit("55", 8), "abuse");
  });

  it("isAllowlisted matches exact", () => {
    const al = { exact: new Set(["5500000000001"]), prefixes: [] };
    assert.ok(isAllowlisted("5500000000001", al));
    assert.ok(!isAllowlisted("5511999999", al));
  });

  it("isAllowlisted matches prefix", () => {
    const al = { exact: new Set(), prefixes: ["5541"] };
    assert.ok(isAllowlisted("5541999999", al));
    assert.ok(!isAllowlisted("5511999999", al));
  });
});
