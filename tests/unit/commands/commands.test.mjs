import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts, seedCustomer } from "../../helpers/db.mjs";
import { PHONES, PIX_CONFIG, TENANT_CONFIG } from "../../helpers/fixtures.mjs";
import { createCommandHandlers } from "../../../shared/commands/index.mjs";

describe("command handlers", () => {
  let db, repos, handlers;
  const phone = PHONES.gustavo;

  beforeEach(() => {
    db = createTestDB();
    repos = createTestRepos(db);
    seedProducts(db);
    seedCustomer(db, { phone });
    handlers = createCommandHandlers(repos, PIX_CONFIG, {
      botPhone: TENANT_CONFIG.bot_phone,
      availableModels: TENANT_CONFIG.available_models,
      defaultModelId: TENANT_CONFIG.llm.model,
    });
  });

  it("returns null for unknown text", () => {
    assert.equal(handlers.tryHandle("quero um café", phone), null);
  });

  it("/ajuda returns help text", () => {
    const r = handlers.tryHandle("/ajuda", phone);
    assert.equal(r.command, "ajuda");
    assert.ok(r.text.includes("Comandos"));
  });

  it("ajuda without slash works", () => {
    const r = handlers.tryHandle("ajuda", phone);
    assert.equal(r.command, "ajuda");
  });

  it("/reiniciar resets session and returns confirmation text", () => {
    const r = handlers.tryHandle("/reiniciar", phone);
    assert.equal(r.command, "reiniciar");
    assert.equal(r.resetSession, true);
    assert.ok(r.text);
    assert.ok(r.text.includes("reiniciada"));
  });

  it("/carrinho with empty cart", () => {
    const r = handlers.tryHandle("/carrinho", phone);
    assert.equal(r.command, "carrinho");
    assert.ok(r.text.toLowerCase().includes("vazio"));
  });

  it("/carrinho with items", () => {
    repos.cart.addItem(phone, "CDA-MOKA-MRCHOC-250", 2, 48);
    const r = handlers.tryHandle("/carrinho", phone);
    assert.ok(r.text.includes("Mr. Chocolate"));
    assert.ok(r.text.includes("96.00"));
  });

  it("/pedido with no pending order", () => {
    const r = handlers.tryHandle("/pedido", phone);
    assert.equal(r.command, "pedido");
    assert.ok(r.text.toLowerCase().includes("nenhum"));
  });

  it("/pedido with pending order", () => {
    repos.orders.create(phone, {
      name: "Test", items: [{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 1, unit_price: 48 }],
      subtotal: 48, discount: 0, shipping: null, total: 48, cep: null, notes: null,
    });
    const r = handlers.tryHandle("/pedido", phone);
    assert.ok(r.text.includes("Mr. Chocolate"));
    assert.ok(r.text.includes("48.00"));
  });

  it("/confirma with pending order generates PIX", () => {
    repos.orders.create(phone, {
      name: "Test", items: [{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 1, unit_price: 48 }],
      subtotal: 48, discount: 0, shipping: null, total: 48, cep: null, notes: null,
    });
    const r = handlers.tryHandle("/confirma", phone);
    assert.equal(r.command, "confirma");
    assert.ok(r.text.includes("confirmado"));
    assert.ok(Array.isArray(r.messages));
    assert.equal(r.messages.length, 2);
  });

  it("/confirma with no pending order", () => {
    const r = handlers.tryHandle("/confirma", phone);
    assert.ok(r.text.includes("Nenhum pedido pendente"));
  });

  it("confirmar alias works", () => {
    const r = handlers.tryHandle("confirmar", phone);
    assert.equal(r.command, "confirma");
  });

  it("/cancelar cancels pending order", () => {
    repos.orders.create(phone, {
      name: "Test", items: [{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 1, unit_price: 48 }],
      subtotal: 48, discount: 0, shipping: null, total: 48, cep: null, notes: null,
    });
    const r = handlers.tryHandle("/cancelar", phone);
    assert.ok(r.text.includes("cancelado"));
  });

  it("cancela alias works", () => {
    const r = handlers.tryHandle("cancela", phone);
    assert.equal(r.command, "cancelar");
  });

  it("/indicar returns referral code", () => {
    const r = handlers.tryHandle("/indicar", phone);
    assert.equal(r.command, "indicar");
    assert.ok(r.text.includes("TEST-"));
  });

  it("meucodigo alias works", () => {
    const r = handlers.tryHandle("meucodigo", phone);
    assert.equal(r.command, "indicar");
  });

  it("/modelo shows menu", () => {
    const r = handlers.tryHandle("/modelo", phone);
    assert.equal(r.command, "modelo");
    assert.ok(r.text.includes("Modelos disponíveis"));
  });

  it("/modelo 2 selects different model and resets session", () => {
    const r = handlers.tryHandle("/modelo 2", phone);
    assert.equal(r.command, "modelo");
    assert.equal(r.resetSession, true);
    assert.ok(r.text.includes("alterado"));
  });
});
