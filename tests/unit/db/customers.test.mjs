import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos } from "../../helpers/db.mjs";

describe("customers repo", () => {
  let sql, repos;

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
  });

  after(async () => { await sql.end(); });

  it("upsert creates new customer", async () => {
    await repos.customers.upsert("5541999", { push_name: "Gus" });
    const c = await repos.customers.getByPhone("5541999");
    assert.ok(c);
    assert.equal(c.push_name, "Gus");
    assert.ok(c.first_seen_at);
  });

  it("upsert updates last_seen_at on existing", async () => {
    await repos.customers.upsert("5541998", { push_name: "A" });
    const c1 = await repos.customers.getByPhone("5541998");
    await new Promise(r => setTimeout(r, 10));
    await repos.customers.upsert("5541998", {});
    const c2 = await repos.customers.getByPhone("5541998");
    assert.ok(c2.last_seen_at >= c1.last_seen_at);
  });

  it("getByPhone returns null for unknown", async () => {
    assert.equal(await repos.customers.getByPhone("000"), null);
  });

  it("updateInfo updates name and cep", async () => {
    await repos.customers.upsert("55001", {});
    await repos.customers.updateInfo("55001", { name: "João", cep: "80000000" });
    const c = await repos.customers.getByPhone("55001");
    assert.equal(c.name, "João");
    assert.equal(c.cep, "80000000");
  });

  it("setNPS sets score", async () => {
    await repos.customers.upsert("55002", {});
    await repos.customers.setNPS("55002", 9);
    const c = await repos.customers.getByPhone("55002");
    assert.equal(c.nps_score, 9);
  });

  it("addTag and removeTag manipulate tags", async () => {
    await repos.customers.upsert("55003", {});
    await repos.customers.addTag("55003", "vip");
    await repos.customers.addTag("55003", "beta");
    let c = await repos.customers.getByPhone("55003");
    const tags = JSON.parse(c.tags);
    assert.ok(tags.includes("vip"));
    assert.ok(tags.includes("beta"));
    await repos.customers.removeTag("55003", "vip");
    c = await repos.customers.getByPhone("55003");
    assert.ok(!JSON.parse(c.tags).includes("vip"));
  });

  it("ensureReferralCode generates and is idempotent", async () => {
    await repos.customers.upsert("55004", {});
    const code1 = await repos.customers.ensureReferralCode("55004");
    assert.ok(code1.startsWith("TEST-"));
    const code2 = await repos.customers.ensureReferralCode("55004");
    assert.equal(code1, code2);
  });

  it("setAccessStatus changes status", async () => {
    await repos.customers.upsert("55005", {});
    await repos.customers.setAccessStatus("55005", "blocked");
    const c = await repos.customers.getByPhone("55005");
    assert.equal(c.access_status, "blocked");
  });

  it("findByAccessStatus filters correctly", async () => {
    await repos.customers.upsert("55010", {}); await repos.customers.setAccessStatus("55010", "active");
    await repos.customers.upsert("55011", {}); await repos.customers.setAccessStatus("55011", "blocked");
    await repos.customers.upsert("55012", {}); await repos.customers.setAccessStatus("55012", "active");
    const active = await repos.customers.findByAccessStatus("active");
    assert.ok(active.length >= 2);
  });
});
