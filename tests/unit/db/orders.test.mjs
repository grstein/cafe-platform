import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts } from "../../helpers/db.mjs";

describe("orders repo", () => {
  let db, repos;
  beforeEach(() => { db = createTestDB(); repos = createTestRepos(db); seedProducts(db); });

  const ITEMS = JSON.stringify([{ sku: "CDA-MOKA-MRCHOC-250", name: "Mr. Chocolate", qty: 2, unit_price: 48 }]);

  it("create inserts order with pending status", () => {
    const id = repos.orders.create("55", { name: "Jo", items: ITEMS, subtotal: 96, total: 96 });
    assert.ok(id > 0);
    const o = repos.orders.getById(id);
    assert.equal(o.status, "pending");
    assert.equal(o.total, 96);
  });

  it("getPending returns pending or undefined", () => {
    repos.orders.create("55", { items: ITEMS, subtotal: 96, total: 96 });
    assert.ok(repos.orders.getPending("55"));
    assert.equal(repos.orders.getPending("99"), undefined);
  });

  it("confirm changes status and sets confirmed_at", () => {
    repos.orders.create("55", { items: ITEMS, subtotal: 96, total: 96 });
    const o = repos.orders.confirm("55");
    assert.ok(o);
    assert.equal(o.status, "confirmed");
    assert.ok(o.confirmed_at);
  });

  it("confirm returns undefined when no pending", () => {
    assert.equal(repos.orders.confirm("55"), undefined);
  });

  it("cancel changes status", () => {
    repos.orders.create("55", { items: ITEMS, subtotal: 96, total: 96 });
    const o = repos.orders.cancel("55");
    assert.ok(o);
    assert.equal(o.status, "cancelled");
  });

  it("listByPhone returns orders with filter", () => {
    repos.orders.create("55", { items: ITEMS, subtotal: 96, total: 96 });
    repos.orders.confirm("55");
    repos.orders.create("55", { items: ITEMS, subtotal: 48, total: 48 });
    const all = repos.orders.listByPhone("55", {});
    assert.equal(all.length, 2);
    const pending = repos.orders.listByPhone("55", { status: "pending" });
    assert.equal(pending.length, 1);
  });

  it("getStats calculates totals", () => {
    repos.orders.create("55", { items: ITEMS, subtotal: 96, total: 96 });
    repos.orders.confirm("55");
    const s = repos.orders.getStats("55");
    assert.ok(s.totalOrders >= 1);
  });
});
