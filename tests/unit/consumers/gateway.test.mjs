import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EVOLUTION_PAYLOAD, PHONES, APP_CONFIG } from "../../helpers/fixtures.mjs";
import { createMockChannel } from "../../helpers/rabbitmq.mjs";
import { createTestDB, createTestRepos, seedCustomer } from "../../helpers/db.mjs";

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

// ── Access control (allowlist enforcement) ───────────────────────────────────

// Inline the access-control logic mirrored from gateway.mjs so we can unit-test
// it without spinning up RabbitMQ.
const REFERRAL_CODE_PREFIX = "TEST-";
const _esc = REFERRAL_CODE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CODE_PATTERN = new RegExp(`\\b${_esc}[A-HJ-NP-Z2-9]{4}\\b`, "i");

function handleAccess({ phone, text, pushName }, config, repos, mockChannel) {
  const allowlist = { exact: new Set([PHONES.primary]), prefixes: [] };
  const allowed = isAllowlisted(phone, allowlist);

  if (!allowed) {
    const customer = repos.customers.getByPhone(phone);
    if (!customer || customer.access_status === "blocked") {
      const codeMatch = text.match(CODE_PATTERN);
      if (codeMatch) {
        const code = codeMatch[0].toUpperCase();
        const referral = repos.referrals.validate(code);
        if (referral) {
          repos.customers.upsert(phone, { push_name: pushName, access_status: "invited", referred_by_phone: referral.referrer_phone });
          mockChannel.publish("msg.flow", "outgoing", Buffer.from(JSON.stringify({ type: "welcome", phone })));
          return "welcome";
        }
      }
      // Unknown number, no valid code → silent discard
      return "denied";
    }
    // Customer exists and is not blocked (invited/active) → fall through
  } else {
    repos.customers.upsert(phone, { push_name: pushName, access_status: "active" });
  }

  mockChannel.publish("msg.flow", "validated", Buffer.from(JSON.stringify({ phone, text })));
  return "allowed";
}

describe("gateway access control", () => {
  let db, repos;
  beforeEach(() => {
    db = createTestDB();
    repos = createTestRepos(db);
  });

  it("allows allowlisted number through to validated", () => {
    const ch = createMockChannel();
    const result = handleAccess(
      { phone: PHONES.primary, text: "oi", pushName: "Gustavo" },
      APP_CONFIG, repos, ch
    );
    assert.equal(result, "allowed");
    assert.equal(ch.published.length, 1);
    assert.equal(ch.published[0].routingKey, "validated");
  });

  it("silently discards unknown number with no referral code — no message published", () => {
    const ch = createMockChannel();
    const result = handleAccess(
      { phone: PHONES.unknown, text: "oi quero cafe", pushName: "Intruder" },
      APP_CONFIG, repos, ch
    );
    assert.equal(result, "denied");
    assert.equal(ch.published.length, 0, "must publish nothing for unknown numbers");
  });

  it("silently discards unknown number whose text does not contain a code", () => {
    const ch = createMockChannel();
    const result = handleAccess(
      { phone: PHONES.unknown, text: "quero saber o preco", pushName: "Stranger" },
      APP_CONFIG, repos, ch
    );
    assert.equal(result, "denied");
    assert.equal(ch.published.length, 0);
  });

  it("silently discards blocked customer even if in allowlist by customer record", () => {
    seedCustomer(db, { phone: PHONES.unknown, accessStatus: "blocked" });
    const ch = createMockChannel();
    const result = handleAccess(
      { phone: PHONES.unknown, text: "oi", pushName: "Blocked" },
      APP_CONFIG, repos, ch
    );
    assert.equal(result, "denied");
    assert.equal(ch.published.length, 0);
  });

  it("allows invited customer (joined via referral) through even if not in static allowlist", () => {
    seedCustomer(db, { phone: PHONES.unknown, access_status: "invited" });
    const ch = createMockChannel();
    const result = handleAccess(
      { phone: PHONES.unknown, text: "oi", pushName: "Invited" },
      APP_CONFIG, repos, ch
    );
    assert.equal(result, "allowed");
    assert.equal(ch.published[0].routingKey, "validated");
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
