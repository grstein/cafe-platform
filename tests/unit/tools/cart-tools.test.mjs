import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts, seedCustomer } from "../../helpers/db.mjs";
import { PHONES } from "../../helpers/fixtures.mjs";
import { createCartTools } from "../../../shared/tools/cart-tools.mjs";

describe("cart tools", () => {
  let sql, repos, tools;
  const phone = PHONES.primary;
  const findTool = (name) => tools.find(t => t.name === name);

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
    await seedProducts(sql);
    await seedCustomer(sql, { phone });
    tools = createCartTools(phone, repos);
  });

  after(async () => { await sql.end(); });

  it("add_to_cart with valid SKU", async () => {
    await repos.cart.clear(phone);
    const r = await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 2 });
    assert.ok(r.content[0].text.includes("adicionado"));
    assert.ok(Math.abs(r.details.subtotal - 96) < 0.01);
  });

  it("add_to_cart with invalid SKU", async () => {
    const r = await findTool("add_to_cart").execute("c1", { sku: "INVALID" });
    assert.ok(r.details.error);
    assert.ok(r.content[0].text.includes("não encontrado"));
  });

  it("update_cart changes qty", async () => {
    await repos.cart.clear(phone);
    await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 1 });
    const r = await findTool("update_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 3 });
    assert.ok(Math.abs(r.details.subtotal - 144) < 0.01);
  });

  it("update_cart with qty 0 removes item", async () => {
    await repos.cart.clear(phone);
    await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 1 });
    const r = await findTool("update_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 0 });
    assert.equal(r.details.count, 0);
  });

  it("remove_from_cart removes item", async () => {
    await repos.cart.clear(phone);
    await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 1 });
    const r = await findTool("remove_from_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250" });
    assert.ok(r.content[0].text.includes("removido"));
  });

  it("view_cart empty", async () => {
    await repos.cart.clear(phone);
    const r = await findTool("view_cart").execute("c1", {});
    assert.equal(r.details.count, 0);
    assert.ok(r.content[0].text.toLowerCase().includes("vazio"));
  });

  it("view_cart with items", async () => {
    await repos.cart.clear(phone);
    await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 1 });
    const r = await findTool("view_cart").execute("c1", {});
    assert.ok(r.content[0].text.includes("Mr. Chocolate"));
    assert.ok(r.details.count >= 1);
  });

  it("checkout converts cart to order", async () => {
    await repos.cart.clear(phone);
    await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 2 });
    const r = await findTool("checkout").execute("c1", { customer_name: "Alice" });
    assert.ok(r.details.orderId);
    assert.ok(Math.abs(r.details.total - 96) < 0.01);
    const cart = await repos.cart.getSummary(phone);
    assert.equal(cart.count, 0);
  });

  it("checkout with empty cart errors", async () => {
    await repos.cart.clear(phone);
    await repos.orders.cancel(phone);
    const r = await findTool("checkout").execute("c1", { customer_name: "Alice" });
    assert.ok(r.details.error);
  });

  it("add_to_cart blocked when pending order exists", async () => {
    await repos.cart.clear(phone);
    await repos.orders.cancel(phone);
    const items = JSON.stringify([{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 1, unit_price: 48 }]);
    await repos.orders.create(phone, { items, subtotal: 48, total: 48 });
    const r = await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 1 });
    assert.ok(r.details.error);
    assert.ok(r.details.pendingOrderId);
    assert.ok(r.content[0].text.includes("/confirma"));
    assert.ok(r.content[0].text.includes("/cancelar"));
    await repos.orders.cancel(phone);
  });

  it("checkout blocked when pending order exists", async () => {
    await repos.cart.clear(phone);
    await repos.orders.cancel(phone);
    const items = JSON.stringify([{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 1, unit_price: 48 }]);
    await repos.orders.create(phone, { items, subtotal: 48, total: 48 });
    const r = await findTool("checkout").execute("c1", { customer_name: "Alice" });
    assert.ok(r.details.error);
    assert.ok(r.details.pendingOrderId);
    await repos.orders.cancel(phone);
  });
});
