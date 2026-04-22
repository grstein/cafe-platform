import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts, seedCustomer } from "../../helpers/db.mjs";
import { PHONES, PIX_CONFIG, APP_CONFIG } from "../../helpers/fixtures.mjs";
import { createCommandHandlers } from "../../../shared/commands/index.mjs";

describe("command handlers", () => {
  let sql, repos, handlers;
  const phone = PHONES.primary;

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
    await seedProducts(sql);
    await seedCustomer(sql, { phone });
    handlers = createCommandHandlers(repos, PIX_CONFIG, {
      botPhone:        APP_CONFIG.bot_phone,
      availableModels: APP_CONFIG.available_models,
      defaultModelId:  APP_CONFIG.llm.model,
    });
  });

  after(async () => { await sql.end(); });

  it("returns null for unknown text", async () => {
    assert.equal(await handlers.tryHandle("quero um café", phone), null);
  });

  it("/ajuda returns help text", async () => {
    const r = await handlers.tryHandle("/ajuda", phone);
    assert.equal(r.command, "ajuda");
    assert.ok(r.text.includes("Comandos"));
  });

  it("ajuda without slash works", async () => {
    const r = await handlers.tryHandle("ajuda", phone);
    assert.equal(r.command, "ajuda");
  });

  it("/reiniciar resets session", async () => {
    const r = await handlers.tryHandle("/reiniciar", phone);
    assert.equal(r.command, "reiniciar");
    assert.equal(r.resetSession, true);
    assert.ok(r.text.includes("reiniciada"));
  });

  it("/carrinho with empty cart", async () => {
    const r = await handlers.tryHandle("/carrinho", phone);
    assert.equal(r.command, "carrinho");
    assert.ok(r.text.toLowerCase().includes("vazio"));
  });

  it("/carrinho shows items when cart has products", async () => {
    await repos.cart.addItem(phone, "CDA-MOKA-MRCHOC-250", 2, 48);
    const r = await handlers.tryHandle("/carrinho", phone);
    assert.ok(r.text.includes("Subtotal"));
    await repos.cart.clear(phone);
  });

  it("/pedido with no pending order", async () => {
    const r = await handlers.tryHandle("/pedido", phone);
    assert.equal(r.command, "pedido");
    assert.ok(r.text.includes("Nenhum"));
  });

  it("/pedido shows order when pending", async () => {
    const items = JSON.stringify([{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 1, unit_price: 48 }]);
    await repos.orders.create(phone, { items, subtotal: 48, total: 48 });
    const r = await handlers.tryHandle("/pedido", phone);
    assert.ok(r.text.includes("pendente"));
    await repos.orders.cancel(phone);
  });

  it("/cancelar with no pending", async () => {
    const r = await handlers.tryHandle("/cancelar", phone);
    assert.ok(r.text.includes("Nenhum"));
  });

  it("/cancelar cancels pending order", async () => {
    const items = JSON.stringify([{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 1, unit_price: 48 }]);
    await repos.orders.create(phone, { items, subtotal: 48, total: 48 });
    const r = await handlers.tryHandle("/cancelar", phone);
    assert.ok(r.text.includes("cancelado"));
  });

  it("/confirma with no pending", async () => {
    const r = await handlers.tryHandle("/confirma", phone);
    assert.ok(r.text.includes("Nenhum"));
  });

  it("/confirma generates PIX brcode", async () => {
    const items = JSON.stringify([{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 1, unit_price: 48 }]);
    await repos.orders.create(phone, { items, subtotal: 48, total: 48 });
    const r = await handlers.tryHandle("/confirma", phone);
    assert.ok(r.messages?.length >= 2, "should return instruction + PIX code");
    assert.ok(r.messages[1].length > 20, "PIX code should be a long string");
  });

  it("/indicar returns referral code", async () => {
    const r = await handlers.tryHandle("/indicar", phone);
    assert.ok(r.text.includes("TEST-"));
  });

  it("/modelo without choice shows menu", async () => {
    const r = await handlers.tryHandle("/modelo", phone);
    assert.equal(r.command, "modelo");
    assert.ok(r.text.includes("Modelos"));
  });

  it("/modelo with valid choice changes model and resets session", async () => {
    const r = await handlers.tryHandle("/modelo 2", phone);
    assert.equal(r.resetSession, true);
    assert.ok(r.text.includes("Sonnet") || r.text.includes("modelo"));
  });

  it("/modelo with invalid choice returns error", async () => {
    const r = await handlers.tryHandle("/modelo 99", phone);
    assert.ok(r.text.includes("inválido"));
  });
});
