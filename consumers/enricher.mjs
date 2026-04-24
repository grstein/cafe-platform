/**
 * @fileoverview Enricher Consumer — context enrichment before agent processing.
 *
 * Reads from:   enricher.ready (msg.flow ready)
 * Publishes to: msg.flow enriched
 */

import { connect, publish, consume, ack, nack } from "../shared/lib/rabbitmq.mjs";
import { parseFromRabbitMQ, setStage, enrichContext } from "../shared/lib/envelope.mjs";
import { loadConfig, getConfig } from "../shared/lib/config.mjs";
import { getDB, initDB } from "../shared/db/connection.mjs";
import { createCustomerRepo } from "../shared/db/customers.mjs";
import { createOrderRepo } from "../shared/db/orders.mjs";
import { createCartRepo } from "../shared/db/cart.mjs";
import { createConversationRepo } from "../shared/db/conversations.mjs";
import { createReferralRepo } from "../shared/db/referrals.mjs";

const RABBITMQ_URI = process.env.RABBITMQ_URI;
const QUEUE = "enricher.ready";
const PREFETCH = Number(process.env.PREFETCH) || 8;

let repos = null;
function getRepos() {
  if (repos) return repos;
  const sql = getDB();
  repos = {
    customers:     createCustomerRepo(sql),
    orders:        createOrderRepo(sql),
    cart:          createCartRepo(sql),
    conversations: createConversationRepo(sql),
    referrals:     createReferralRepo(sql),
  };
  return repos;
}

/**
 * Stable context injected ONCE per Pi Agent session (first turn after cache miss / TTL).
 * Subsequent turns rely on Pi SessionManager's own message history and on tools
 * (view_cart, list_orders) for fresh data — no need to re-inject.
 */
function buildContextBlock(customer, cart, orders, history) {
  const lines = ["[CONTEXTO DO CLIENTE]"];

  if (customer) {
    lines.push(`Nome: ${customer.name || customer.push_name || "não informado"}`);
    if (customer.cep) lines.push(`CEP: ${customer.cep}`);
    if (customer.city) lines.push(`Cidade: ${customer.city}/${customer.state || ""}`);
    if (Number(customer.total_orders) > 0) lines.push(`Pedidos anteriores: ${customer.total_orders} (total: R$ ${Number(customer.total_spent || 0).toFixed(2)})`);
    if (customer.nps_score != null) lines.push(`NPS: ${customer.nps_score}/10`);
    if (customer.tags) {
      try {
        const tags = JSON.parse(customer.tags);
        if (tags.length) lines.push(`Tags: ${tags.join(", ")}`);
      } catch {}
    }
    if (customer.referred_by_phone) lines.push(`Indicado por: telefone ${customer.referred_by_phone}`);
  }

  if (cart && cart.count > 0) {
    lines.push("", "[CARRINHO ATUAL]");
    for (const item of cart.items) {
      lines.push(`- ${item.qty}x ${item.product_name || item.product_sku} (R$ ${(Number(item.qty) * Number(item.unit_price)).toFixed(2)})`);
    }
    lines.push(`Subtotal: R$ ${cart.subtotal.toFixed(2)}`);
  }

  if (orders && orders.length > 0) {
    lines.push("", "[ÚLTIMOS PEDIDOS]");
    for (const o of orders) {
      const items = typeof o.items === "string" ? JSON.parse(o.items) : o.items;
      const desc = items.map(i => `${i.qty}x ${i.name}`).join(", ");
      lines.push(`- #${process.env.ORDER_PREFIX || ""}${o.id} (${o.status}) ${desc} — R$ ${Number(o.total).toFixed(2)} (${String(o.created_at).slice(0, 10)})`);
    }
  }

  if (history && history.length > 0) {
    lines.push("", "[HISTÓRICO RECENTE]");
    for (const h of history.slice(-10)) {
      const role = h.role === "user" ? "Cliente" : "Você";
      lines.push(`${role}: ${h.content.substring(0, 150)}`);
    }
  }

  return lines.join("\n");
}

/**
 * Per-turn ephemeral block. Currently only the batch marker when the aggregator
 * merged multiple WhatsApp messages into a single turn. Prepended on every turn
 * it applies — not stored as stable context.
 */
function buildTurnBlock(envelope) {
  if (!envelope.payload.is_batch) return "";
  const lines = [`[MENSAGENS EM SEQUÊNCIA — ${envelope.payload.batch_count} mensagens]`];
  for (const m of envelope.payload.messages) {
    lines.push(`${String(m.ts || "").substring(11, 19)} — "${m.text}"`);
  }
  lines.push("(Trate como uma única solicitação)");
  return lines.join("\n");
}

async function main() {
  console.log("🟢 Enricher consumer starting...");
  await initDB();
  const sql = getDB();
  await loadConfig(sql);
  const { connection, channel } = await connect(RABBITMQ_URI);

  consume(channel, QUEUE, async (msg) => {
    if (!msg) return;
    try {
      const envelope = parseFromRabbitMQ(msg);
      const { phone } = envelope;
      console.log(`[enricher] Processing ${phone} text="${envelope.payload?.merged_text?.substring(0, 50)}"`);

      const r = getRepos();
      const config = getConfig();
      const pushName = envelope.payload.messages[0]?.pushName;
      await r.customers.upsert(phone, { push_name: pushName });
      const ttl = config.session?.ttl_minutes || 30;

      // Parallelize independent reads — all keyed by phone, none depend on each other.
      const [customer, history, cart, orders, msgCount] = await Promise.all([
        r.customers.getByPhone(phone),
        r.conversations.getRecent(phone, ttl),
        r.cart.getSummary(phone),
        r.orders.getRecent(phone, 3),
        r.conversations.getCount(phone, ttl),
      ]);
      const softLimit = config.session?.soft_limit || 40;
      const hardLimit = config.session?.hard_limit || 60;

      const contextBlock = buildContextBlock(customer, cart, orders, history);
      const turnBlock = buildTurnBlock(envelope);

      enrichContext(envelope, "customer", customer);
      enrichContext(envelope, "cart", cart);
      enrichContext(envelope, "last_orders", orders);
      enrichContext(envelope, "conversation_history", history);
      enrichContext(envelope, "context_block", contextBlock);
      enrichContext(envelope, "turn_block", turnBlock);
      enrichContext(envelope, "app_config", config);
      enrichContext(envelope, "session_msg_count", msgCount);
      enrichContext(envelope, "session_soft_limit", softLimit);
      enrichContext(envelope, "session_hard_limit", hardLimit);

      setStage(envelope, "enriched");
      publish(channel, "msg.flow", "enriched", envelope);
      ack(channel, msg);
    } catch (err) {
      console.error("[enricher] Error:", err.message);
      nack(channel, msg, !msg.fields.redelivered);
    }
  }, { prefetch: PREFETCH });

  console.log(`🟢 Enricher listening on ${QUEUE}`);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      console.log(`🔴 Enricher shutting down (${sig})`);
      await channel.close(); await connection.close(); process.exit(0);
    });
  }
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
