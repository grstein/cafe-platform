import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts } from "../../helpers/db.mjs";

describe("products repo", () => {
  let sql, repos;

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
    await seedProducts(sql);
  });

  after(async () => { await sql.end(); });

  it("search returns all available without filter", async () => {
    const r = await repos.products.search({});
    assert.ok(r.length >= 3);
  });

  it("search filters by query", async () => {
    const r = await repos.products.search({ query: "Chocolate" });
    assert.ok(r.length >= 1);
    assert.ok(r[0].name.includes("Chocolate"));
  });

  it("search filters by maxPrice", async () => {
    const r = await repos.products.search({ maxPrice: 50 });
    assert.ok(r.every(p => Number(p.price) <= 50));
  });

  it("search excludes unavailable by default", async () => {
    await repos.products.setAvailable("CDA-MOKA-MRCHOC-250", false);
    const r = await repos.products.search({});
    assert.ok(!r.find(p => p.sku === "CDA-MOKA-MRCHOC-250"));
    await repos.products.setAvailable("CDA-MOKA-MRCHOC-250", true);
  });

  it("getBySku returns product or null", async () => {
    const p = await repos.products.getBySku("CDA-MOKA-MRCHOC-250");
    assert.ok(p);
    assert.equal(p.name, "Mr. Chocolate");
    assert.equal(await repos.products.getBySku("FAKE"), null);
  });

  it("getAvailable returns only available", async () => {
    await repos.products.setAvailable("CDA-MOKA-MRCHOC-250", false);
    const r = await repos.products.getAvailable();
    assert.ok(!r.find(p => p.sku === "CDA-MOKA-MRCHOC-250"));
    assert.ok(r.length >= 2);
    await repos.products.setAvailable("CDA-MOKA-MRCHOC-250", true);
  });

  it("updateStock changes stock value", async () => {
    const initial = (await repos.products.getBySku("CDA-MOKA-MRCHOC-250")).stock;
    await repos.products.updateStock("CDA-MOKA-MRCHOC-250", -5);
    const after = (await repos.products.getBySku("CDA-MOKA-MRCHOC-250")).stock;
    assert.equal(Number(after), Number(initial) - 5);
  });
});
