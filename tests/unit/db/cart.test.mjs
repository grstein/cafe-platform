import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts } from "../../helpers/db.mjs";

describe("cart repo", () => {
  let sql, repos;

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
    await seedProducts(sql);
  });

  after(async () => { await sql.end(); });

  it("addItem inserts new item", async () => {
    await repos.cart.addItem("55", "CDA-MOKA-MRCHOC-250", 2, 48);
    const items = await repos.cart.getItems("55");
    assert.equal(items.length, 1);
    assert.equal(Number(items[0].qty), 2);
  });

  it("addItem upserts same SKU", async () => {
    await repos.cart.addItem("56", "CDA-MOKA-MRCHOC-250", 1, 48);
    await repos.cart.addItem("56", "CDA-MOKA-MRCHOC-250", 3, 48);
    const items = await repos.cart.getItems("56");
    assert.equal(items.length, 1);
    assert.equal(Number(items[0].qty), 3);
  });

  it("removeItem removes by SKU", async () => {
    await repos.cart.addItem("57", "CDA-MOKA-MRCHOC-250", 1, 48);
    await repos.cart.removeItem("57", "CDA-MOKA-MRCHOC-250");
    assert.equal((await repos.cart.getItems("57")).length, 0);
  });

  it("clear removes all items", async () => {
    await repos.cart.addItem("58", "CDA-MOKA-MRCHOC-250", 1, 48);
    await repos.cart.addItem("58", "CDA-LUCCA-HONEY-250", 1, 79);
    await repos.cart.clear("58");
    assert.equal((await repos.cart.getItems("58")).length, 0);
  });

  it("getSummary calculates correctly", async () => {
    await repos.cart.addItem("59", "CDA-MOKA-MRCHOC-250", 2, 48);
    await repos.cart.addItem("59", "CDA-LUCCA-HONEY-250", 1, 79);
    const s = await repos.cart.getSummary("59");
    assert.equal(s.count, 3);
    assert.ok(Math.abs(s.subtotal - (2 * 48 + 79)) < 0.01);
  });

  it("getSummary empty cart", async () => {
    const s = await repos.cart.getSummary("99999");
    assert.equal(s.count, 0);
    assert.equal(s.subtotal, 0);
  });

  it("getItems includes product_name via JOIN", async () => {
    await repos.cart.addItem("60", "CDA-MOKA-MRCHOC-250", 1, 48);
    const items = await repos.cart.getItems("60");
    assert.equal(items[0].product_name, "Mr. Chocolate");
  });
});
