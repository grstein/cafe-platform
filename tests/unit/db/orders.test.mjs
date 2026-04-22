import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts } from "../../helpers/db.mjs";

describe("orders repo", () => {
  let sql, repos;

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
    await seedProducts(sql);
  });

  after(async () => { await sql.end(); });

  const ITEMS = JSON.stringify([{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 2, unit_price: 48 }]);

  it("create inserts order with pending status", async () => {
    const id = await repos.orders.create("551", { name: "Jo", items: ITEMS, subtotal: 96, total: 96 });
    assert.ok(id > 0);
    const o = await repos.orders.getById(id);
    assert.equal(o.status, "pending");
    assert.ok(Math.abs(Number(o.total) - 96) < 0.01);
  });

  it("getPending returns pending or null", async () => {
    await repos.orders.create("552", { items: ITEMS, subtotal: 96, total: 96 });
    assert.ok(await repos.orders.getPending("552"));
    assert.equal(await repos.orders.getPending("99999"), null);
  });

  it("confirm changes status and sets confirmed_at", async () => {
    await repos.orders.create("553", { items: ITEMS, subtotal: 96, total: 96 });
    const o = await repos.orders.confirm("553");
    assert.ok(o);
    assert.equal(o.status, "confirmed");
    assert.ok(o.confirmed_at);
  });

  it("confirm returns null when no pending", async () => {
    assert.equal(await repos.orders.confirm("99998"), null);
  });

  it("cancel changes status", async () => {
    await repos.orders.create("554", { items: ITEMS, subtotal: 96, total: 96 });
    const o = await repos.orders.cancel("554");
    assert.ok(o);
    assert.equal(o.status, "cancelled");
  });

  it("listByPhone returns orders with filter", async () => {
    await repos.orders.create("555", { items: ITEMS, subtotal: 96, total: 96 });
    await repos.orders.confirm("555");
    await repos.orders.create("555", { items: ITEMS, subtotal: 48, total: 48 });
    const all = await repos.orders.listByPhone("555", {});
    assert.equal(all.length, 2);
    const pending = await repos.orders.listByPhone("555", { status: "pending" });
    assert.equal(pending.length, 1);
  });

  it("getStats calculates totals", async () => {
    await repos.orders.create("556", { items: ITEMS, subtotal: 96, total: 96 });
    await repos.orders.confirm("556");
    const s = await repos.orders.getStats("556");
    assert.ok(s.totalOrders >= 1);
  });
});
