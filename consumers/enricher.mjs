/**
 * @fileoverview Enricher Consumer — context enrichment before agent processing.
 *
 * Reads from: enricher.ready (msg.flow ready)
 * Publishes to: msg.flow enriched
 */

import { connect, publish, consume, ack, nack } from "../shared/lib/rabbitmq.mjs";
import { parseFromRabbitMQ, setStage, enrichContext } from "../shared/lib/envelope.mjs";
import { getConfig } from "../shared/lib/config.mjs";
import { getDB } from "../shared/db/connection.mjs";
import { createCustomerRepo } from "../shared/db/customers.mjs";
import { createOrderRepo } from "../shared/db/orders.mjs";
import { createCartRepo } from "../shared/db/cart.mjs";
import { createConversationRepo } from "../shared/db/conversations.mjs";
import { createReferralRepo } from "../shared/db/referrals.mjs";

const RABBITMQ_URI = process.env.RABBITMQ_URI;
const QUEUE = "enricher.ready";

// Repos initialized once
let repos = null;

function getRepos() {
  if (repos) return repos;
  const db = getDB(process.env.DATA_DIR);
  repos = {
    customers: createCustomerRepo(db),
    orders: createOrderRepo(db),
    cart: createCartRepo(db),
    conversations: createConversationRepo(db),
    referrals: createReferralRepo(db),
  };
  return repos;
}

function buildContextBlock(customer, cart, orders, history, config, envelope) {
  const lines = ["[CONTEXTO DO CLIENTE]"];

  if (customer) {
    lines.push(`Nome: ${customer.name || customer.push_name || "não informado"}`);
    if (customer.cep) lines.push(`CEP: ${customer.cep}`);
    if (customer.city) lines.push(`Cidade: ${customer.city}/${customer.state || ""}`);
    if (customer.total_orders > 0) lines.push(`Pedidos anteriores: ${customer.total_orders} (total: R$ ${(customer.total_spent || 0).toFixed(2)})`);
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
      lines.push(`- ${item.qty}x ${item.product_name || item.product_sku} (R$ ${(item.qty * item.unit_price).toFixed(2)})`);
    }
    lines.push(`Subtotal: R$ ${cart.subtotal.toFixed(2)}`);
  }

  if (orders && orders.length > 0) {
    lines.push("", "[ÚLTIMOS PEDIDOS]");
    for (const o of orders) {
      const items = typeof o.items === "string" ? JSON.parse(o.items) : o.items;
      const desc = items.map(i => `${i.qty}x ${i.name}`).join(", ");
      lines.push(`- #${process.env.ORDER_PREFIX || ""}${o.id} (${o.status}) ${desc} — R$ ${o.total.toFixed(2)} (${o.created_at})`);
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
      lines.push(`${m.ts?.substring(11, 19) || ""} — "${m.text}"`);
    }
    lines.push("(Trate como uma única solicitação)");
  }

  return lines.join("\n");
}

async function main() {
  console.log("🟢 Enricher consumer starting...");
  const { connection, channel } = await connect(RABBITMQ_URI);
  const config = getConfig();

  consume(channel, QUEUE, async (msg) => {
    if (!msg) return;
    try {
      const envelope = parseFromRabbitMQ(msg);
      const { phone } = envelope;
      console.log(`[enricher] Processing ${phone} text="${envelope.payload?.merged_text?.substring(0, 50)}"`);

      const r = getRepos();

      // Get/upsert customer
      const pushName = envelope.payload.messages[0]?.pushName;
      r.customers.upsert(phone, { push_name: pushName });
      const customer = r.customers.getByPhone(phone);

      // Load context
      const ttl = config.session?.ttl_minutes || 30;
      const history = r.conversations.getRecent(phone, ttl);
      const cart = r.cart.getSummary(phone);
      const orders = r.orders.getRecent ? r.orders.getRecent(phone, 3) : [];

      // Session limits
      const msgCount = r.conversations.getCount(phone, ttl);
      const softLimit = config.session?.soft_limit || 40;
      const hardLimit = config.session?.hard_limit || 60;

      // Build context block
      const contextBlock = buildContextBlock(customer, cart, orders, history, config, envelope);

      // Enrich envelope
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
