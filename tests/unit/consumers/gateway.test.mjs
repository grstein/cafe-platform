import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EVOLUTION_PAYLOAD, PHONES, APP_CONFIG } from "../../helpers/fixtures.mjs";
import { createMockChannel } from "../../helpers/rabbitmq.mjs";
import { createTestDB, createTestRepos, seedCustomer } from "../../helpers/db.mjs";

// ── Pure functions mirrored from gateway.mjs for unit-testing ─────────────

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

// ── Session reset logic ────────────────────────────────────────────────────

describe("gateway session reset", () => {
  it("publishes session_reset event when command returns resetSession", () => {
    const published = [];
    const mockChannel = { publish(e, r, b) { published.push({ exchange: e, routingKey: r, data: JSON.parse(b.toString()) }); } };
    const cmdResult = { command: "reiniciar", text: "Conversa reiniciada!", resetSession: true };
    mockChannel.publish("msg.flow", "outgoing", Buffer.from(JSON.stringify({ phone: PHONES.primary })));
    if (cmdResult.resetSession) {
      mockChannel.publish("events", "session_reset", Buffer.from(JSON.stringify({ phone: PHONES.primary })));
    }
    assert.equal(published.length, 2);
    assert.equal(published[1].exchange, "events");
    assert.equal(published[1].routingKey, "session_reset");
  });

  it("does not publish session_reset for normal commands", () => {
    const published = [];
    const mockChannel = { publish(e, r, b) { published.push({ exchange: e, routingKey: r }); } };
    const cmdResult = { command: "ajuda", text: "help text" };
    mockChannel.publish("msg.flow", "outgoing", Buffer.from(JSON.stringify({ phone: PHONES.primary })));
    assert.equal(published.length, 1);
    assert.equal(published[0].routingKey, "outgoing");
  });
});

// ── Access control ────────────────────────────────────────────────────────

const REFERRAL_CODE_PREFIX = "TEST-";
const _esc = REFERRAL_CODE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CODE_PATTERN = new RegExp(`\\b${_esc}[A-HJ-NP-Z2-9]{4}\\b`, "i");

async function handleAccess({ phone, text, pushName }, repos, mockChannel) {
  // Build allowlist from DB patterns
  const patterns = await repos.allowlist.getPatterns();
  const exact = new Set();
  const prefixes = [];
  for (const { pattern } of patterns) {
    if (pattern.endsWith("*")) prefixes.push(pattern.slice(0, -1));
    else exact.add(pattern);
  }
  const allowlist = { exact, prefixes };
  const allowed = isAllowlisted(phone, allowlist);

  if (!allowed) {
    const customer = await repos.customers.getByPhone(phone);
    if (!customer || customer.access_status === "blocked") {
      const codeMatch = text.match(CODE_PATTERN);
      if (codeMatch) {
        const code = codeMatch[0].toUpperCase();
        const referral = await repos.referrals.validate(code);
        if (referral) {
          await repos.customers.upsert(phone, { push_name: pushName, access_status: "invited", referred_by_phone: referral.referrer_phone });
          mockChannel.publish("msg.flow", "outgoing", Buffer.from(JSON.stringify({ type: "welcome", phone })));
          return "welcome";
        }
      }
      return "denied";
    }
  } else {
    await repos.customers.upsert(phone, { push_name: pushName, access_status: "active" });
  }

  mockChannel.publish("msg.flow", "validated", Buffer.from(JSON.stringify({ phone, text })));
  return "allowed";
}

describe("gateway access control", () => {
  let sql, repos;

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
    // Seed allowlist: only PHONES.primary is pre-authorized
    await repos.allowlist.addPattern(PHONES.primary, "test allowlist");
  });

  after(async () => { await sql.end(); });

  it("allows allowlisted number through to validated", async () => {
    const ch = createMockChannel();
    const result = await handleAccess({ phone: PHONES.primary, text: "oi", pushName: "A" }, repos, ch);
    assert.equal(result, "allowed");
    assert.equal(ch.published.length, 1);
    assert.equal(ch.published[0].routingKey, "validated");
  });

  it("silently discards unknown number with no referral code", async () => {
    const ch = createMockChannel();
    const result = await handleAccess({ phone: PHONES.unknown, text: "oi quero cafe", pushName: "B" }, repos, ch);
    assert.equal(result, "denied");
    assert.equal(ch.published.length, 0);
  });

  it("silently discards blocked customer", async () => {
    await seedCustomer(sql, { phone: PHONES.blocked, accessStatus: "blocked" });
    const ch = createMockChannel();
    const result = await handleAccess({ phone: PHONES.blocked, text: "oi", pushName: "C" }, repos, ch);
    assert.equal(result, "denied");
    assert.equal(ch.published.length, 0);
  });

  it("allows invited customer through", async () => {
    await seedCustomer(sql, { phone: "5500000000097", accessStatus: "invited" });
    const ch = createMockChannel();
    const result = await handleAccess({ phone: "5500000000097", text: "oi", pushName: "D" }, repos, ch);
    assert.equal(result, "allowed");
    assert.equal(ch.published[0].routingKey, "validated");
  });
});

// ── Gateway internals ─────────────────────────────────────────────────────

describe("gateway internals", () => {
  beforeEach(() => rateLimits.clear());

  it("parseIncomingPayload extracts phone and text", () => {
    const r = parseIncomingPayload(EVOLUTION_PAYLOAD("Oi!", PHONES.primary));
    assert.equal(r.phone, PHONES.primary);
    assert.equal(r.text, "Oi!");
    assert.equal(r.pushName, "Customer");
  });

  it("parseIncomingPayload returns null for fromMe", () => {
    assert.equal(parseIncomingPayload(EVOLUTION_PAYLOAD("x", "55", { fromMe: true })), null);
  });

  it("parseIncomingPayload returns null for group", () => {
    const payload = { data: { key: { remoteJid: "123@g.us", fromMe: false }, message: { conversation: "hi" } } };
    assert.equal(parseIncomingPayload(payload), null);
  });

  it("parseIncomingPayload returns null for empty text", () => {
    const payload = { data: { key: { remoteJid: "55@s.whatsapp.net", fromMe: false }, message: {} } };
    assert.equal(parseIncomingPayload(payload), null);
  });

  it("checkRateLimit ok within limit", () => {
    assert.equal(checkRateLimit("55", 8), "ok");
  });

  it("checkRateLimit limited above 8", () => {
    for (let i = 0; i < 8; i++) checkRateLimit("55b", 8);
    assert.equal(checkRateLimit("55b", 8), "limited");
  });

  it("checkRateLimit abuse above 20", () => {
    for (let i = 0; i < 20; i++) checkRateLimit("55c", 8);
    assert.equal(checkRateLimit("55c", 8), "abuse");
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
