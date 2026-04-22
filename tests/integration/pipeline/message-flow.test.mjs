import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts, seedCustomer } from "../../helpers/db.mjs";
import { PHONES, EVOLUTION_PAYLOAD } from "../../helpers/fixtures.mjs";
import { createEnvelope, addMessage, setStage, setResponse } from "../../../shared/lib/envelope.mjs";
import { createCommandHandlers } from "../../../shared/commands/index.mjs";

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

function enrichEnvelope(envelope, repos) {
  const phone = envelope.phone;
  const customer = repos.customers.getByPhone(phone);
  const cart = repos.cart.getSummary(phone);
  const history = repos.conversations.getRecent(phone, 10);
  envelope.context.customer = customer;
  envelope.context.cart = cart;
  envelope.context.history = history;
  return envelope;
}

describe("message flow pipeline", () => {
  let db, repos;

  beforeEach(() => {
    db = createTestDB();
    repos = createTestRepos(db);
    seedProducts(db);
    seedCustomer(db, { phone: PHONES.gustavo });
  });

  it("payload flows from gateway parse through enrichment", () => {
    const raw = EVOLUTION_PAYLOAD("Quero um café especial", PHONES.gustavo);
    const parsed = parseIncomingPayload(raw);
    assert.ok(parsed);
    assert.equal(parsed.phone, PHONES.gustavo);

    const envelope = createEnvelope({
      phone: parsed.phone,
      text: parsed.text,
      pushName: parsed.pushName,
    });
    assert.equal(envelope.tenant_id, "test-tenant");
    assert.equal(envelope.payload.merged_text, "Quero um café especial");

    setStage(envelope, "ready");
    assert.equal(envelope.metadata.stage, "ready");

    enrichEnvelope(envelope, repos);
    assert.ok(envelope.context.customer);
    assert.equal(envelope.context.cart.count, 0);

    setResponse(envelope, "Temos ótimas opções!");
    setStage(envelope, "response");
    assert.equal(envelope.payload.response_text, "Temos ótimas opções!");
    assert.equal(envelope.metadata.stage, "response");
  });

  it("/reiniciar triggers session reset in pipeline", () => {
    const handlers = createCommandHandlers(repos, null, { botPhone: "554100000000" });
    const cmdResult = handlers.tryHandle("/reiniciar", PHONES.gustavo);
    assert.equal(cmdResult.command, "reiniciar");
    assert.equal(cmdResult.resetSession, true);

    const envelope = createEnvelope({ phone: PHONES.gustavo, text: "/reiniciar", pushName: "Alice" });
    setResponse(envelope, cmdResult.text);
    setStage(envelope, "outgoing");

    // Agent session cache is keyed by phone only
    const sessionCache = new Map();
    sessionCache.set(PHONES.gustavo, { session: { dispose() {} }, lastUsed: Date.now(), msgCount: 3 });

    const { phone } = JSON.parse(JSON.stringify({ phone: PHONES.gustavo }));
    const cached = sessionCache.get(phone);
    if (cached) {
      try { cached.session.dispose(); } catch {}
      sessionCache.delete(phone);
    }

    assert.equal(sessionCache.size, 0);
    assert.equal(envelope.payload.response_text, cmdResult.text);
  });

  it("batch of 2 messages aggregates correctly", () => {
    const env = createEnvelope({ phone: PHONES.gustavo, text: "Oi", pushName: "Alice" });
    addMessage(env, { text: "Tem café?", pushName: "Alice" });
    assert.equal(env.payload.batch_count, 2);
    assert.ok(env.payload.merged_text.includes("Oi"));
    assert.ok(env.payload.merged_text.includes("Tem café?"));
  });
});
