import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts, seedCustomer } from "../../helpers/db.mjs";
import { PHONES } from "../../helpers/fixtures.mjs";
import { createOrderTools } from "../../../shared/tools/order-tools.mjs";

describe("order tools", () => {
  let sql, repos, tools;
  const phone = PHONES.primary;
  const findTool = (name) => tools.find(t => t.name === name);

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
    await seedProducts(sql);
    await seedCustomer(sql, { phone });
    tools = createOrderTools(phone, repos);
  });

  after(async () => { await sql.end(); });

  it("create_order with valid items", async () => {
    const r = await findTool("create_order").execute("c1", {
      customer_name: "Alice",
      items: [{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 1, unit_price: 48 }],
    });
    assert.ok(r.details.orderId);
    assert.ok(Math.abs(r.details.total - 48) < 0.01);
  });

  it("create_order with invalid SKU", async () => {
    const r = await findTool("create_order").execute("c2", {
      customer_name: "Alice",
      items: [{ sku: "INVALID", name: "X", qty: 1, unit_price: 10 }],
    });
    assert.ok(r.details.error);
  });

  it("create_order with wrong price", async () => {
    const r = await findTool("create_order").execute("c3", {
      customer_name: "Alice",
      items: [{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 1, unit_price: 99 }],
    });
    assert.ok(r.details.error);
    assert.ok(r.content[0].text.includes("preço"));
  });

  it("list_orders with no orders returns empty message", async () => {
    // Use a fresh phone that has never placed an order
    const noOrdersTools = createOrderTools("99999888", repos);
    const listTool = noOrdersTools.find(t => t.name === "list_orders");
    const r = await listTool.execute("c4", {});
    assert.equal(r.details.count, 0);
    assert.ok(r.content[0].text.includes("não possui"));
  });

  it("list_orders after creating order returns 1", async () => {
    await findTool("create_order").execute("c5", {
      customer_name: "Alice",
      items: [{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 1, unit_price: 48 }],
    });
    const r = await findTool("list_orders").execute("c6", {});
    assert.ok(r.details.count >= 1);
  });
});
