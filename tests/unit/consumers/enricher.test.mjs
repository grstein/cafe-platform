import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Inline copies of the pure helpers from consumers/enricher.mjs (no DB).
function buildContextBlock(customer, cart, orders, history) {
  const lines = ["[CONTEXTO DO CLIENTE]"];
  if (customer) {
    lines.push("Nome: " + (customer.name || customer.push_name || "não informado"));
    if (customer.cep) lines.push("CEP: " + customer.cep);
    if (Number(customer.total_orders) > 0) lines.push("Pedidos anteriores: " + customer.total_orders);
  }
  if (cart && cart.count > 0) {
    lines.push("", "[CARRINHO ATUAL]");
    for (const item of cart.items) lines.push("- " + item.qty + "x " + (item.product_name || item.product_sku));
    lines.push("Subtotal: R$ " + cart.subtotal.toFixed(2));
  }
  if (orders && orders.length > 0) {
    lines.push("", "[ÚLTIMOS PEDIDOS]");
    for (const o of orders) lines.push("- #TEST-" + o.id + " (" + o.status + ") R$ " + Number(o.total).toFixed(2) + " (" + String(o.created_at).slice(0, 10) + ")");
  }
  if (history && history.length > 0) {
    lines.push("", "[HISTÓRICO RECENTE]");
    for (const h of history.slice(-10)) {
      const role = h.role === "user" ? "Cliente" : "Você";
      lines.push(role + ": " + h.content.substring(0, 150));
    }
  }
  return lines.join("\n");
}

function buildTurnBlock(envelope) {
  if (!envelope?.payload?.is_batch) return "";
  const lines = ["[MENSAGENS EM SEQUÊNCIA — " + envelope.payload.batch_count + " mensagens]"];
  for (const m of envelope.payload.messages) lines.push('"' + m.text + '"');
  lines.push("(Trate como uma única solicitação)");
  return lines.join("\n");
}

describe("enricher buildContextBlock (stable, session-scoped)", () => {
  it("includes customer name", () => {
    const r = buildContextBlock({ name: "João", push_name: "Jo", total_orders: 0 }, null, [], []);
    assert.ok(r.includes("João"));
  });

  it("includes cart items and subtotal", () => {
    const cart = { count: 1, items: [{ qty: 2, product_name: "Mr. Chocolate", unit_price: 48 }], subtotal: 96 };
    const r = buildContextBlock(null, cart, [], []);
    assert.ok(r.includes("Mr. Chocolate"));
    assert.ok(r.includes("96.00"));
  });

  it("includes order history", () => {
    const orders = [{ id: 1, status: "confirmed", total: 96, items: "[]", created_at: "2026-01-01" }];
    const r = buildContextBlock(null, null, orders, []);
    assert.ok(r.includes("#TEST-1"));
  });

  it("does NOT include batch marker (turn-scoped)", () => {
    const r = buildContextBlock({ name: "João", total_orders: 0 }, null, [], []);
    assert.ok(!r.includes("MENSAGENS EM SEQUÊNCIA"));
  });
});

describe("enricher buildTurnBlock (ephemeral, per-turn)", () => {
  it("formats batch messages", () => {
    const envelope = { payload: { is_batch: true, batch_count: 2, messages: [{ text: "cafe" }, { text: "chocolate" }] } };
    const r = buildTurnBlock(envelope);
    assert.ok(r.includes("2 mensagens"));
    assert.ok(r.includes("cafe"));
    assert.ok(r.includes("chocolate"));
  });

  it("returns empty string when not a batch", () => {
    const envelope = { payload: { is_batch: false, batch_count: 1, messages: [{ text: "oi" }] } };
    assert.equal(buildTurnBlock(envelope), "");
  });

  it("returns empty string for missing payload", () => {
    assert.equal(buildTurnBlock({}), "");
    assert.equal(buildTurnBlock({ payload: {} }), "");
  });
});
