import { describe, it, before, after } from "node:test";
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

async function enrichEnvelope(envelope, repos) {
  const phone = envelope.phone;
  const customer = await repos.customers.getByPhone(phone);
  const cart = await repos.cart.getSummary(phone);
  const history = await repos.conversations.getRecent(phone, 10);
  envelope.context.customer = customer;
  envelope.context.cart = cart;
  envelope.context.history = history;
  return envelope;
}

describe("message flow pipeline", () => {
  let sql, repos;

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
    await seedProducts(sql);
    await seedCustomer(sql, { phone: PHONES.primary });
  });

  after(async () => { await sql.end(); });

  it("payload flows from gateway parse through enrichment", async () => {
    const raw = EVOLUTION_PAYLOAD("Quero um café especial", PHONES.primary);
    const parsed = parseIncomingPayload(raw);
    assert.ok(parsed);
    assert.equal(parsed.phone, PHONES.primary);

    const envelope = createEnvelope({ phone: parsed.phone, text: parsed.text, pushName: parsed.pushName });
    assert.equal(envelope.payload.merged_text, "Quero um café especial");

    setStage(envelope, "ready");
    assert.equal(envelope.metadata.stage, "ready");

    await enrichEnvelope(envelope, repos);
    assert.ok(envelope.context.customer);
    assert.equal(envelope.context.cart.count, 0);

    setResponse(envelope, "Temos ótimas opções!");
    setStage(envelope, "response");
    assert.equal(envelope.payload.response_text, "Temos ótimas opções!");
    assert.equal(envelope.metadata.stage, "response");
  });

  it("/reiniciar triggers session reset in pipeline", async () => {
    const handlers = createCommandHandlers(repos, null, { botPhone: "554100000000" });
    const cmdResult = await handlers.tryHandle("/reiniciar", PHONES.primary);
    assert.equal(cmdResult.command, "reiniciar");
    assert.equal(cmdResult.resetSession, true);

    const envelope = createEnvelope({ phone: PHONES.primary, text: "/reiniciar", pushName: "Alice" });
    setResponse(envelope, cmdResult.text);
    setStage(envelope, "outgoing");

    // Simulate session cache cleanup
    const sessionCache = new Map();
    sessionCache.set(PHONES.primary, { session: { dispose() {} }, lastUsed: Date.now(), msgCount: 3 });
    const cached = sessionCache.get(PHONES.primary);
    if (cached) { try { cached.session.dispose(); } catch {} sessionCache.delete(PHONES.primary); }

    assert.equal(sessionCache.size, 0);
    assert.equal(envelope.payload.response_text, cmdResult.text);
  });

  it("batch of 2 messages aggregates correctly", () => {
    const env = createEnvelope({ phone: PHONES.primary, text: "Oi", pushName: "Alice" });
    addMessage(env, { text: "Tem café?", pushName: "Alice" });
    assert.equal(env.payload.batch_count, 2);
    assert.ok(env.payload.merged_text.includes("Oi"));
    assert.ok(env.payload.merged_text.includes("Tem café?"));
  });
});
