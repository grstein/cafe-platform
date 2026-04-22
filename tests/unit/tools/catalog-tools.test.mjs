import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts } from "../../helpers/db.mjs";
import { createCatalogTools } from "../../../shared/tools/catalog-tools.mjs";

describe("catalog tools", () => {
  let sql, repos, tools;

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
    await seedProducts(sql);
    tools = createCatalogTools(repos);
  });

  after(async () => { await sql.end(); });

  const searchCatalog = () => tools[0];

  it("search without filters returns all products", async () => {
    const r = await searchCatalog().execute("c1", {});
    assert.ok(r.details.count >= 3);
  });

  it("search by query finds matching product", async () => {
    const r = await searchCatalog().execute("c1", { query: "chocolate" });
    assert.ok(r.details.count >= 1);
    assert.ok(r.content[0].text.includes("Mr. Chocolate"));
  });

  it("search by max_price filters", async () => {
    const r = await searchCatalog().execute("c1", { max_price: 50 });
    assert.ok(r.details.products.every(p => Number(p.price) <= 50));
  });

  it("search by min_sca filters", async () => {
    const r = await searchCatalog().execute("c1", { min_sca: 86 });
    assert.ok(r.details.products.every(p => p.sca_score >= 86));
  });

  it("no matches returns message", async () => {
    const r = await searchCatalog().execute("c1", { query: "nonexistent-xyz-123" });
    assert.equal(r.details.count, 0);
    assert.ok(r.content[0].text.includes("Nenhum"));
  });
});
