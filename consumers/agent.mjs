/**
 * @fileoverview Agent Consumer — LLM processing via Pi Agent SDK.
 *
 * Reads from:   agent.enriched (msg.flow enriched)
 * Publishes to: msg.flow response
 */

import path from "path";
import {
  AuthStorage,
  ModelRegistry,
  SettingsManager,
  SessionManager,
  createAgentSession,
} from "@mariozechner/pi-coding-agent";

import { connect, publish, consume, ack, nack } from "../shared/lib/rabbitmq.mjs";
import { parseFromRabbitMQ, setStage, setResponse } from "../shared/lib/envelope.mjs";
import { loadConfig, getConfig } from "../shared/lib/config.mjs";
import { getDB, initDB } from "../shared/db/connection.mjs";
import { createConversationRepo } from "../shared/db/conversations.mjs";
import { createCustomerRepo } from "../shared/db/customers.mjs";
import { createProductRepo } from "../shared/db/products.mjs";
import { createOrderRepo } from "../shared/db/orders.mjs";
import { createCartRepo } from "../shared/db/cart.mjs";
import { createReferralRepo } from "../shared/db/referrals.mjs";
import { createOrderTools } from "../shared/tools/order-tools.mjs";
import { createCatalogTools } from "../shared/tools/catalog-tools.mjs";
import { createCustomerTools } from "../shared/tools/customer-tools.mjs";
import { createCartTools } from "../shared/tools/cart-tools.mjs";
import { createReferralTools } from "../shared/tools/referral-tools.mjs";

const RABBITMQ_URI = process.env.RABBITMQ_URI;
const QUEUE = "agent.enriched";
const CONFIG_DIR = process.env.CONFIG_DIR || "/config/pi";
// Sessions are written to a writable volume, not inside pi-config (which may be :ro)
const SESSIONS_DIR = path.join(process.env.DATA_DIR || "/data", "pi-sessions");

// Pi Agent SDK — shared across invocations
const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage, path.join(CONFIG_DIR, "models.json"));
const settingsManager = SettingsManager.create(CONFIG_DIR, CONFIG_DIR);

// Session cache per phone
const sessionCache = new Map();

let repos = null;
function getRepos() {
  if (repos) return repos;
  const sql = getDB();
  repos = {
    customers:     createCustomerRepo(sql),
    products:      createProductRepo(sql),
    orders:        createOrderRepo(sql),
    cart:          createCartRepo(sql),
    referrals:     createReferralRepo(sql),
    conversations: createConversationRepo(sql),
  };
  return repos;
}

function buildCustomTools(phone, r, botPhone, displayName) {
  return [
    ...createOrderTools(phone, r),
    ...createCatalogTools(r),
    ...createCustomerTools(phone, r),
    ...createCartTools(phone, r),
    ...createReferralTools(phone, r, botPhone, displayName),
  ];
}

function resolveModel(config, customer) {
  let modelId = config.llm?.model || "anthropic/claude-haiku-4.5";
  if (customer?.preferences) {
    try {
      const prefs = typeof customer.preferences === "string" ? JSON.parse(customer.preferences) : customer.preferences;
      if (prefs.modelo) modelId = prefs.modelo;
    } catch {}
  }
  const model = modelRegistry.find("openrouter", modelId);
  if (!model) {
    console.warn(`[agent] Model "${modelId}" not found, falling back to default`);
    return modelRegistry.find("openrouter", config.llm?.model || "anthropic/claude-haiku-4.5");
  }
  return model;
}

async function main() {
  console.log("🟢 Agent consumer starting...");
  await initDB();
  await loadConfig(getDB());
  const { connection, channel } = await connect(RABBITMQ_URI);

  consume(channel, QUEUE, async (msg) => {
    if (!msg) return;
    let session = null;
    try {
      const envelope = parseFromRabbitMQ(msg);
      const { phone } = envelope;
      console.log(`[agent] Received ${phone} text="${envelope.payload?.merged_text?.substring(0, 50)}"`);

      const appConfig = envelope.context.app_config || getConfig();
      const customer = envelope.context.customer;
      const contextBlock = envelope.context.context_block || "";
      const turnBlock = envelope.context.turn_block || "";
      const r = getRepos();
      const botPhone = process.env.BOT_PHONE || appConfig.bot_phone || "";
      const displayName = appConfig.display_name || "";

      const model = resolveModel(appConfig, customer);
      if (!model) { console.error("[agent] No model available"); nack(channel, msg, false); return; }

      const userText = envelope.payload.merged_text;
      const thinking = appConfig.llm?.thinking || "medium";
      const ttlMs = (appConfig.session?.ttl_minutes || 30) * 60 * 1000;

      // Reuse or create session
      const cached = sessionCache.get(phone);
      const now = Date.now();
      const isNewSession = !(cached && now - cached.lastUsed < ttlMs);

      if (!isNewSession) {
        session = cached.session;
        cached.lastUsed = now;
        cached.msgCount++;
      } else {
        if (cached?.session) { try { cached.session.dispose(); } catch {} }
        const customTools = buildCustomTools(phone, r, botPhone, displayName);
        console.log(`[agent] Creating session model=${model?.id} tools=${customTools.length}`);
        const sessionDir = path.join(SESSIONS_DIR, phone);
        const result = await createAgentSession({
          model,
          thinking,
          cwd: CONFIG_DIR,       // SDK walks up from here to find AGENTS.md
          agentDir: CONFIG_DIR,
          authStorage,
          modelRegistry,
          settingsManager,
          sessionManager: SessionManager.create(CONFIG_DIR, sessionDir),
          customTools,
        });
        session = result.session;
        sessionCache.set(phone, { session, lastUsed: now, msgCount: 1 });
      }

      // Prepend stable context ONLY on new session (cache miss / TTL expired).
      // Pi AgentSession persists its own message history, so re-injecting the
      // same customer/cart/orders every turn just inflates tokens and duplicates
      // history. Turn-local context (batch marker) is always prepended.
      const promptParts = [];
      if (isNewSession && contextBlock) promptParts.push(contextBlock);
      if (turnBlock) promptParts.push(turnBlock);
      promptParts.push(userText);
      const enrichedPrompt = promptParts.join("\n\n");

      console.log(`[agent] Prompting (${enrichedPrompt.length} chars)...`);
      await session.prompt(enrichedPrompt);
      const responseText = session.getLastAssistantText() || "";
      console.log(`[agent] Response (${responseText.length} chars): "${responseText.substring(0, 100)}"`);

      // Persist conversation history
      await r.conversations.addMessage(phone, "user", userText);
      await r.conversations.addMessage(phone, "assistant", responseText);

      setResponse(envelope, responseText);
      setStage(envelope, "response");
      publish(channel, "msg.flow", "response", envelope);
      ack(channel, msg);
    } catch (err) {
      console.error("[agent] Error:", err.message);
      nack(channel, msg, !msg.fields.redelivered);
    }
  });

  // Session reset events
  await channel.assertQueue("agent.session_reset", { durable: true, arguments: { "x-dead-letter-exchange": "dlx" } });
  await channel.bindQueue("agent.session_reset", "events", "session_reset");
  consume(channel, "agent.session_reset", (resetMsg) => {
    if (!resetMsg) return;
    try {
      const { phone } = JSON.parse(resetMsg.content.toString());
      const cached = sessionCache.get(phone);
      if (cached) {
        try { cached.session.dispose(); } catch {}
        sessionCache.delete(phone);
        console.log(`[agent] Session reset for ${phone}`);
      }
    } catch {}
    ack(channel, resetMsg);
  });

  // Session cache cleanup
  setInterval(() => {
    const cutoff = Date.now() - 35 * 60 * 1000;
    for (const [phone, cached] of sessionCache) {
      if (cached.lastUsed < cutoff) {
        try { cached.session.dispose(); } catch {}
        sessionCache.delete(phone);
      }
    }
  }, 5 * 60 * 1000);

  console.log(`🟢 Agent listening on ${QUEUE}`);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      console.log(`🔴 Agent shutting down (${sig})`);
      for (const [, c] of sessionCache) { try { c.session.dispose(); } catch {} }
      await channel.close(); await connection.close(); process.exit(0);
    });
  }
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
