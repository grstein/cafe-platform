import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts } from "../../helpers/db.mjs";
import { createCatalogTools } from "../../../shared/tools/catalog-tools.mjs";

describe("catalog tools", () => {
  let repos, searchCatalog;

  beforeEach(() => {
    const db = createTestDB();
    repos = createTestRepos(db);
    seedProducts(db);
    [searchCatalog] = createCatalogTools(repos);
  });

  it("search without filters returns all products", async () => {
    const r = await searchCatalog.execute("c1", {});
    assert.equal(r.details.count, 3);
  });

  it("search by query finds matching product", async () => {
    const r = await searchCatalog.execute("c1", { query: "chocolate" });
    assert.equal(r.details.count, 1);
    assert.ok(r.content[0].text.includes("Mr. Chocolate"));
  });

  it("search by max_price filters", async () => {
    const r = await searchCatalog.execute("c1", { max_price: 50 });
    assert.equal(r.details.count, 1);
    assert.ok(r.details.skus.includes("CDA-MOKA-MRCHOC-250"));
  });

  it("search by min_sca filters", async () => {
    const r = await searchCatalog.execute("c1", { min_sca: 86 });
    assert.equal(r.details.count, 1);
    assert.ok(r.details.skus.includes("CDA-LUCCA-HONEY-250"));
  });

  it("no matches returns message", async () => {
    const r = await searchCatalog.execute("c1", { query: "nonexistent" });
    assert.equal(r.details.count, 0);
    assert.ok(r.content[0].text.includes("Nenhum"));
  });
});
