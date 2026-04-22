import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts, seedCustomer } from "../../helpers/db.mjs";
import { PHONES } from "../../helpers/fixtures.mjs";
import { createCartTools } from "../../../shared/tools/cart-tools.mjs";

describe("cart tools", () => {
  let repos, tools;
  const phone = PHONES.gustavo;
  const findTool = (name) => tools.find(t => t.name === name);

  beforeEach(() => {
    const db = createTestDB();
    repos = createTestRepos(db);
    seedProducts(db);
    seedCustomer(db, { phone });
    tools = createCartTools(phone, repos);
  });

  it("add_to_cart with valid SKU", async () => {
    const r = await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 2 });
    assert.ok(r.content[0].text.includes("adicionado"));
    assert.equal(r.details.subtotal, 96);
  });

  it("add_to_cart with invalid SKU", async () => {
    const r = await findTool("add_to_cart").execute("c1", { sku: "INVALID" });
    assert.ok(r.details.error);
    assert.ok(r.content[0].text.includes("não encontrado"));
  });

  it("update_cart changes qty", async () => {
    await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 1 });
    const r = await findTool("update_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 3 });
    assert.equal(r.details.subtotal, 144);
  });

  it("update_cart with qty 0 removes item", async () => {
    await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 1 });
    const r = await findTool("update_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 0 });
    assert.equal(r.details.count, 0);
  });

  it("remove_from_cart removes item", async () => {
    await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 1 });
    const r = await findTool("remove_from_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250" });
    assert.ok(r.content[0].text.includes("removido"));
  });

  it("view_cart empty", async () => {
    const r = await findTool("view_cart").execute("c1", {});
    assert.equal(r.details.count, 0);
    assert.ok(r.content[0].text.toLowerCase().includes("vazio"));
  });

  it("view_cart with items", async () => {
    await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 1 });
    const r = await findTool("view_cart").execute("c1", {});
    assert.ok(r.content[0].text.includes("Mr. Chocolate"));
    assert.equal(r.details.count, 1);
  });

  it("checkout converts cart to order", async () => {
    await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 2 });
    const r = await findTool("checkout").execute("c1", { customer_name: "Alice" });
    assert.ok(r.details.orderId);
    assert.equal(r.details.total, 96);
    const cart = repos.cart.getSummary(phone);
    assert.equal(cart.count, 0);
  });

  it("checkout with empty cart errors", async () => {
    const r = await findTool("checkout").execute("c1", { customer_name: "Alice" });
    assert.ok(r.details.error);
  });
});
