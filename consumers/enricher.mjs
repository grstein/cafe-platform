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

function buildContextBlock(customer, cart, orders, history, config, envelope) {
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

  if (envelope.payload.is_batch) {
    lines.push("", `[MENSAGENS EM SEQUÊNCIA — ${envelope.payload.batch_count} mensagens]`);
    for (const m of envelope.payload.messages) {
      lines.push(`${String(m.ts || "").substring(11, 19)} — "${m.text}"`);
    }
    lines.push("(Trate como uma única solicitação)");
  }

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
      const pushName = envelope.payload.messages[0]?.pushName;
      await r.customers.upsert(phone, { push_name: pushName });
      const customer = await r.customers.getByPhone(phone);

      const ttl = config.session?.ttl_minutes || 30;
      const history = await r.conversations.getRecent(phone, ttl);
      const cart = await r.cart.getSummary(phone);
      const orders = await r.orders.getRecent(phone, 3);

      const msgCount = await r.conversations.getCount(phone, ttl);
      const softLimit = config.session?.soft_limit || 40;
      const hardLimit = config.session?.hard_limit || 60;

      const contextBlock = buildContextBlock(customer, cart, orders, history, config, envelope);

      enrichContext(envelope, "customer", customer);
      enrichContext(envelope, "cart", cart);
      enrichContext(envelope, "last_orders", orders);
      enrichContext(envelope, "conversation_history", history);
      enrichContext(envelope, "context_block", contextBlock);
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
  });

  console.log(`🟢 Enricher listening on ${QUEUE}`);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      console.log(`🔴 Enricher shutting down (${sig})`);
      await channel.close(); await connection.close(); process.exit(0);
    });
  }
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
