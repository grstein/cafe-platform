import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Copy buildContextBlock from enricher.mjs
function buildContextBlock(customer, cart, orders, history, config, envelope) {
  const lines = ["[CONTEXTO DO CLIENTE]"];
  if (customer) {
    lines.push("Nome: " + (customer.name || customer.push_name || "não informado"));
    if (customer.cep) lines.push("CEP: " + customer.cep);
    if (customer.total_orders > 0) lines.push("Pedidos anteriores: " + customer.total_orders);
  }
  if (cart && cart.count > 0) {
    lines.push("", "[CARRINHO ATUAL]");
    for (const item of cart.items) lines.push("- " + item.qty + "x " + (item.product_name || item.product_sku));
    lines.push("Subtotal: R$ " + cart.subtotal.toFixed(2));
  }
  if (orders && orders.length > 0) {
    lines.push("", "[ÚLTIMOS PEDIDOS]");
    for (const o of orders) lines.push("- #TEST-" + o.id + " (" + o.status + ") R$ " + o.total.toFixed(2));
  }
  if (envelope?.payload?.is_batch) {
    lines.push("", "[MENSAGENS EM SEQUÊNCIA — " + envelope.payload.batch_count + " mensagens]");
    for (const m of envelope.payload.messages) lines.push('"' + m.text + '"');
    lines.push("(Trate como uma única solicitação)");
  }
  return lines.join("\n");
}

describe("enricher buildContextBlock", () => {
  it("includes customer name", () => {
    const r = buildContextBlock({ name: "João", push_name: "Jo" }, null, [], [], {}, {});
    assert.ok(r.includes("João"));
  });

  it("includes cart items and subtotal", () => {
    const cart = { count: 1, items: [{ qty: 2, product_name: "Mr. Chocolate", unit_price: 48 }], subtotal: 96 };
    const r = buildContextBlock(null, cart, [], [], {}, {});
    assert.ok(r.includes("Mr. Chocolate"));
    assert.ok(r.includes("96.00"));
  });

  it("includes order history", () => {
    const orders = [{ id: 1, status: "confirmed", total: 96, items: "[]", created_at: "2026-01-01" }];
    const r = buildContextBlock(null, null, orders, [], {}, {});
    assert.ok(r.includes("#TEST-1"));
  });

  it("formats batch messages", () => {
    const envelope = { payload: { is_batch: true, batch_count: 2, messages: [{ text: "cafe" }, { text: "chocolate" }] } };
    const r = buildContextBlock(null, null, [], [], {}, envelope);
    assert.ok(r.includes("2 mensagens"));
    assert.ok(r.includes("cafe"));
    assert.ok(r.includes("chocolate"));
  });
});
