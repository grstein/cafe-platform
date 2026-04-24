import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTestDB, createTestRepos, seedProducts } from "../../helpers/db.mjs";
import { createCatalogTools } from "../../../shared/tools/catalog-tools.mjs";

describe("catalog tools", () => {
  let sql, repos, tools, tmpConfigDir, prevConfigDir;

  before(async () => {
    tmpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-config-"));
    await fs.mkdir(path.join(tmpConfigDir, "catalog"), { recursive: true });
    await fs.writeFile(
      path.join(tmpConfigDir, "catalog", "mr-chocolate.md"),
      "# Mr. Chocolate\n\nOrigem: Cerrado Mineiro. Produtor fictício.\n",
    );
    prevConfigDir = process.env.CONFIG_DIR;
    process.env.CONFIG_DIR = tmpConfigDir;

    sql = await createTestDB();
    repos = createTestRepos(sql);
    await seedProducts(sql);
    tools = createCatalogTools(repos);
  });

  after(async () => {
    await sql.end();
    if (prevConfigDir === undefined) delete process.env.CONFIG_DIR;
    else process.env.CONFIG_DIR = prevConfigDir;
    await fs.rm(tmpConfigDir, { recursive: true, force: true });
  });

  const searchCatalog = () => tools.find(t => t.name === "search_catalog");
  const getProductDetails = () => tools.find(t => t.name === "get_product_details");

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

  it("get_product_details with unknown SKU returns not-found", async () => {
    const r = await getProductDetails().execute("c1", { sku: "NOPE-123" });
    assert.equal(r.details.found, false);
    assert.ok(r.content[0].text.includes("não encontrado"));
  });

  it("get_product_details without knowledge_file returns base fields only", async () => {
    const sku = "CDA-MOKA-MRCHOC-250";
    await repos.products.upsert({ ...(await repos.products.getBySku(sku)), knowledge_file: null });
    const r = await getProductDetails().execute("c1", { sku });
    assert.equal(r.details.found, true);
    assert.equal(r.details.knowledgeStatus, "none");
    assert.ok(r.content[0].text.includes("Mr. Chocolate"));
    assert.ok(!r.content[0].text.includes("FICHA DETALHADA"));
  });

  it("get_product_details reads the markdown file when present", async () => {
    const sku = "CDA-MOKA-MRCHOC-250";
    await repos.products.upsert({ ...(await repos.products.getBySku(sku)), knowledge_file: "catalog/mr-chocolate.md" });
    const r = await getProductDetails().execute("c1", { sku });
    assert.equal(r.details.knowledgeStatus, "ok");
    assert.ok(r.content[0].text.includes("FICHA DETALHADA"));
    assert.ok(r.content[0].text.includes("Cerrado Mineiro"));
  });

  it("get_product_details reports missing file without crashing", async () => {
    const sku = "CDA-MOKA-MRCHOC-250";
    await repos.products.upsert({ ...(await repos.products.getBySku(sku)), knowledge_file: "catalog/does-not-exist.md" });
    const r = await getProductDetails().execute("c1", { sku });
    assert.equal(r.details.knowledgeStatus, "missing");
    assert.ok(r.content[0].text.includes("não encontrado"));
  });

  it("get_product_details blocks path traversal", async () => {
    const sku = "CDA-MOKA-MRCHOC-250";
    await repos.products.upsert({ ...(await repos.products.getBySku(sku)), knowledge_file: "../../../etc/passwd" });
    const r = await getProductDetails().execute("c1", { sku });
    assert.equal(r.details.knowledgeStatus, "blocked");
    assert.ok(!r.content[0].text.includes("root:"));
  });
});
