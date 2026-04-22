import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts } from "../../helpers/db.mjs";

describe("cart repo", () => {
  let db, repos;
  beforeEach(() => { db = createTestDB(); repos = createTestRepos(db); seedProducts(db); });

  it("addItem inserts new item", () => {
    repos.cart.addItem("55", "CDA-MOKA-MRCHOC-250", 2, 48);
    const items = repos.cart.getItems("55");
    assert.equal(items.length, 1);
    assert.equal(items[0].qty, 2);
  });

  it("addItem upserts same SKU", () => {
    repos.cart.addItem("55", "CDA-MOKA-MRCHOC-250", 1, 48);
    repos.cart.addItem("55", "CDA-MOKA-MRCHOC-250", 3, 48);
    const items = repos.cart.getItems("55");
    assert.equal(items.length, 1);
    assert.equal(items[0].qty, 3);
  });

  it("removeItem removes by SKU", () => {
    repos.cart.addItem("55", "CDA-MOKA-MRCHOC-250", 1, 48);
    repos.cart.removeItem("55", "CDA-MOKA-MRCHOC-250");
    assert.equal(repos.cart.getItems("55").length, 0);
  });

  it("clear removes all items", () => {
    repos.cart.addItem("55", "CDA-MOKA-MRCHOC-250", 1, 48);
    repos.cart.addItem("55", "CDA-LUCCA-HONEY-250", 1, 79);
    repos.cart.clear("55");
    assert.equal(repos.cart.getItems("55").length, 0);
  });

  it("getSummary calculates correctly", () => {
    repos.cart.addItem("55", "CDA-MOKA-MRCHOC-250", 2, 48);
    repos.cart.addItem("55", "CDA-LUCCA-HONEY-250", 1, 79);
    const s = repos.cart.getSummary("55");
    assert.equal(s.count, 3); // count = sum of qty (2+1), not distinct items
    assert.equal(s.subtotal, 2 * 48 + 79);
  });

  it("getSummary empty cart", () => {
    const s = repos.cart.getSummary("55");
    assert.equal(s.count, 0);
    assert.equal(s.subtotal, 0);
  });

  it("getItems includes product_name via JOIN", () => {
    repos.cart.addItem("55", "CDA-MOKA-MRCHOC-250", 1, 48);
    const items = repos.cart.getItems("55");
    assert.equal(items[0].product_name, "Mr. Chocolate");
  });
});
