import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts } from "../../helpers/db.mjs";

describe("products repo", () => {
  let db, repos;
  beforeEach(() => { db = createTestDB(); repos = createTestRepos(db); seedProducts(db); });

  it("search returns all available without filter", () => {
    const r = repos.products.search({});
    assert.ok(r.length >= 3);
  });

  it("search filters by query", () => {
    const r = repos.products.search({ query: "Chocolate" });
    assert.ok(r.length >= 1);
    assert.ok(r[0].name.includes("Chocolate"));
  });

  it("search filters by maxPrice", () => {
    const r = repos.products.search({ maxPrice: 50 });
    assert.ok(r.every(p => p.price <= 50));
  });

  it("search excludes unavailable by default", () => {
    repos.products.setAvailable("CDA-MOKA-MRCHOC-250", 0);
    const r = repos.products.search({});
    assert.ok(!r.find(p => p.sku === "CDA-MOKA-MRCHOC-250"));
  });

  it("getBySku returns product or undefined", () => {
    const p = repos.products.getBySku("CDA-MOKA-MRCHOC-250");
    assert.ok(p);
    assert.equal(p.name, "Mr. Chocolate");
    assert.equal(repos.products.getBySku("FAKE"), undefined);
  });

  it("getAvailable returns only available", () => {
    repos.products.setAvailable("CDA-MOKA-MRCHOC-250", 0);
    const r = repos.products.getAvailable();
    assert.ok(!r.find(p => p.sku === "CDA-MOKA-MRCHOC-250"));
    assert.ok(r.length >= 2);
  });

  it("updateStock changes stock value", () => {
    const initial = repos.products.getBySku("CDA-MOKA-MRCHOC-250").stock;
    repos.products.updateStock("CDA-MOKA-MRCHOC-250", -5);
    assert.equal(repos.products.getBySku("CDA-MOKA-MRCHOC-250").stock, initial - 5);
  });
});
