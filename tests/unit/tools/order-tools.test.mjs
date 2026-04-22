import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts, seedCustomer } from "../../helpers/db.mjs";
import { PHONES, PRODUCTS } from "../../helpers/fixtures.mjs";
import { createOrderTools } from "../../../shared/tools/order-tools.mjs";

describe("order tools", () => {
  let repos, tools;
  const phone = PHONES.gustavo;
  const findTool = (name) => tools.find(t => t.name === name);

  beforeEach(() => {
    const db = createTestDB();
    repos = createTestRepos(db);
    seedProducts(db);
    seedCustomer(db, { phone });
    tools = createOrderTools(phone, repos);
  });

  it("create_order with valid items", async () => {
    const r = await findTool("create_order").execute("c1", {
      customer_name: "Alice",
      items: [{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 1, unit_price: 48 }],
    });
    assert.ok(r.details.orderId);
    assert.equal(r.details.total, 48);
  });

  it("create_order with invalid SKU", async () => {
    const r = await findTool("create_order").execute("c1", {
      customer_name: "Alice",
      items: [{ sku: "INVALID", name: "X", qty: 1, unit_price: 10 }],
    });
    assert.ok(r.details.error);
  });

  it("create_order with wrong price", async () => {
    const r = await findTool("create_order").execute("c1", {
      customer_name: "Alice",
      items: [{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 1, unit_price: 99 }],
    });
    assert.ok(r.details.error);
    assert.ok(r.content[0].text.includes("preço"));
  });

  it("list_orders with no orders", async () => {
    const r = await findTool("list_orders").execute("c1", {});
    assert.equal(r.details.count, 0);
    assert.ok(r.content[0].text.includes("não possui"));
  });

  it("list_orders after creating order", async () => {
    await findTool("create_order").execute("c1", {
      customer_name: "Alice",
      items: [{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 1, unit_price: 48 }],
    });
    const r = await findTool("list_orders").execute("c1", {});
    assert.equal(r.details.count, 1);
  });
});
