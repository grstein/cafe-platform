import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedCustomer } from "../../helpers/db.mjs";
import { PHONES } from "../../helpers/fixtures.mjs";

describe("referrals repo", () => {
  let sql, repos;

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
    await seedCustomer(sql, { phone: PHONES.primary });
    await seedCustomer(sql, { phone: PHONES.secondary });
  });

  after(async () => { await sql.end(); });

  it("create returns referral with pending status", async () => {
    const ref = await repos.referrals.create(PHONES.primary, PHONES.secondary, "CODE1");
    assert.equal(ref.status, "pending");
    assert.equal(ref.referrer_phone, PHONES.primary);
    assert.equal(ref.referred_phone, PHONES.secondary);
    assert.equal(ref.reward_type, "discount_percent");
    assert.ok(Math.abs(Number(ref.reward_value) - 10) < 0.01);
  });

  it("create duplicate is ignored (returns existing)", async () => {
    const second = await repos.referrals.create(PHONES.primary, PHONES.secondary, "CODE2");
    assert.equal(second.referral_code_used, "CODE1");
  });

  it("getByReferred returns referral", async () => {
    const ref = await repos.referrals.getByReferred(PHONES.secondary);
    assert.equal(ref.referrer_phone, PHONES.primary);
  });

  it("getByReferred returns null for unknown", async () => {
    assert.equal(await repos.referrals.getByReferred(PHONES.unknown), null);
  });

  it("activate changes status", async () => {
    const changes = await repos.referrals.activate(PHONES.secondary);
    assert.equal(changes, 1);
    const ref = await repos.referrals.getByReferred(PHONES.secondary);
    assert.equal(ref.status, "activated");
    assert.ok(ref.activated_at);
  });

  it("activate already-activated returns 0", async () => {
    const changes = await repos.referrals.activate(PHONES.secondary);
    assert.equal(changes, 0);
  });

  it("markRewarded sets status and order", async () => {
    const ref = await repos.referrals.getByReferred(PHONES.secondary);
    await repos.referrals.markRewarded(ref.id, 42);
    const updated = await repos.referrals.getById(ref.id);
    assert.equal(updated.status, "rewarded");
    assert.equal(Number(updated.reward_applied_to_order), 42);
    assert.ok(updated.rewarded_at);
  });

  it("countByReferrer returns correct counts", async () => {
    await seedCustomer(sql, { phone: PHONES.unknown });
    await repos.referrals.create(PHONES.primary, PHONES.unknown, "CODE1");
    const counts = await repos.referrals.countByReferrer(PHONES.primary);
    assert.ok(counts.total >= 2);
  });

  it("getById returns referral", async () => {
    const ref = await repos.referrals.getByReferred(PHONES.secondary);
    const byId = await repos.referrals.getById(ref.id);
    assert.equal(byId.id, ref.id);
  });

  it("validate returns referrer_phone for valid code", async () => {
    const customer = await repos.customers.getByPhone(PHONES.primary);
    if (customer?.referral_code) {
      const result = await repos.referrals.validate(customer.referral_code);
      assert.ok(result);
      assert.equal(result.referrer_phone, PHONES.primary);
    }
  });

  it("validate returns null for invalid code", async () => {
    const result = await repos.referrals.validate("INVALID-CODE");
    assert.equal(result, null);
  });
});
