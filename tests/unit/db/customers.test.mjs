import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos } from "../../helpers/db.mjs";

describe("customers repo", () => {
  let db, repos;
  beforeEach(() => { db = createTestDB(); repos = createTestRepos(db); });

  it("upsert creates new customer", () => {
    repos.customers.upsert("5541999", { push_name: "Gus" });
    const c = repos.customers.getByPhone("5541999");
    assert.ok(c);
    assert.equal(c.push_name, "Gus");
    assert.ok(c.first_seen_at);
  });

  it("upsert updates last_seen_at on existing", () => {
    repos.customers.upsert("5541999", { push_name: "Gus" });
    const c1 = repos.customers.getByPhone("5541999");
    repos.customers.upsert("5541999", {});
    const c2 = repos.customers.getByPhone("5541999");
    assert.ok(c2.last_seen_at >= c1.last_seen_at);
  });

  it("getByPhone returns undefined for unknown", () => {
    assert.equal(repos.customers.getByPhone("000"), undefined);
  });

  it("updateInfo updates name and cep", () => {
    repos.customers.upsert("55", {});
    repos.customers.updateInfo("55", { name: "João", cep: "80000000" });
    const c = repos.customers.getByPhone("55");
    assert.equal(c.name, "João");
    assert.equal(c.cep, "80000000");
  });

  it("setNPS sets score", () => {
    repos.customers.upsert("55", {});
    repos.customers.setNPS("55", 9);
    const c = repos.customers.getByPhone("55");
    assert.equal(c.nps_score, 9);
  });

  it("addTag and removeTag manipulate tags", () => {
    repos.customers.upsert("55", {});
    repos.customers.addTag("55", "vip");
    repos.customers.addTag("55", "beta");
    let c = repos.customers.getByPhone("55");
    const tags = JSON.parse(c.tags);
    assert.ok(tags.includes("vip"));
    assert.ok(tags.includes("beta"));
    repos.customers.removeTag("55", "vip");
    c = repos.customers.getByPhone("55");
    assert.ok(!JSON.parse(c.tags).includes("vip"));
  });

  it("ensureReferralCode generates and is idempotent", () => {
    repos.customers.upsert("55", {});
    const code1 = repos.customers.ensureReferralCode("55");
    assert.ok(code1.startsWith("TEST-"));
    const code2 = repos.customers.ensureReferralCode("55");
    assert.equal(code1, code2);
  });

  it("setAccessStatus changes status", () => {
    repos.customers.upsert("55", {});
    repos.customers.setAccessStatus("55", "blocked");
    const c = repos.customers.getByPhone("55");
    assert.equal(c.access_status, "blocked");
  });

  it("findByAccessStatus filters correctly", () => {
    repos.customers.upsert("1", {}); repos.customers.setAccessStatus("1", "active");
    repos.customers.upsert("2", {}); repos.customers.setAccessStatus("2", "blocked");
    repos.customers.upsert("3", {}); repos.customers.setAccessStatus("3", "active");
    const active = repos.customers.findByAccessStatus("active");
    assert.equal(active.length, 2);
  });
});
