import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedCustomer } from "../../helpers/db.mjs";
import { PHONES } from "../../helpers/fixtures.mjs";

describe("referrals repo", () => {
  let db, repos;
  beforeEach(() => {
    db = createTestDB();
    repos = createTestRepos(db);
    seedCustomer(db, { phone: PHONES.gustavo });
    seedCustomer(db, { phone: PHONES.beta });
  });

  it("create returns referral with pending status", () => {
    const ref = repos.referrals.create(PHONES.gustavo, PHONES.beta, "CODE1");
    assert.equal(ref.status, "pending");
    assert.equal(ref.referrer_phone, PHONES.gustavo);
    assert.equal(ref.referred_phone, PHONES.beta);
    assert.equal(ref.reward_type, "discount_percent");
    assert.equal(ref.reward_value, 10);
  });

  it("create duplicate is ignored", () => {
    repos.referrals.create(PHONES.gustavo, PHONES.beta, "CODE1");
    const second = repos.referrals.create(PHONES.gustavo, PHONES.beta, "CODE2");
    assert.equal(second.referral_code_used, "CODE1");
  });

  it("getByReferred returns referral", () => {
    repos.referrals.create(PHONES.gustavo, PHONES.beta, "CODE1");
    const ref = repos.referrals.getByReferred(PHONES.beta);
    assert.equal(ref.referrer_phone, PHONES.gustavo);
  });

  it("getByReferred returns undefined for unknown", () => {
    const ref = repos.referrals.getByReferred(PHONES.unknown);
    assert.equal(ref, undefined);
  });

  it("activate changes status", () => {
    repos.referrals.create(PHONES.gustavo, PHONES.beta, "CODE1");
    const changes = repos.referrals.activate(PHONES.beta);
    assert.equal(changes, 1);
    const ref = repos.referrals.getByReferred(PHONES.beta);
    assert.equal(ref.status, "activated");
    assert.ok(ref.activated_at);
  });

  it("activate on already-activated returns 0", () => {
    repos.referrals.create(PHONES.gustavo, PHONES.beta, "CODE1");
    repos.referrals.activate(PHONES.beta);
    const changes = repos.referrals.activate(PHONES.beta);
    assert.equal(changes, 0);
  });

  it("markRewarded sets status and order", () => {
    repos.referrals.create(PHONES.gustavo, PHONES.beta, "CODE1");
    repos.referrals.activate(PHONES.beta);
    const ref = repos.referrals.getByReferred(PHONES.beta);
    repos.referrals.markRewarded(ref.id, 42);
    const updated = repos.referrals.getById(ref.id);
    assert.equal(updated.status, "rewarded");
    assert.equal(updated.reward_applied_to_order, 42);
    assert.ok(updated.rewarded_at);
  });

  it("countByReferrer returns correct counts", () => {
    seedCustomer(db, { phone: PHONES.unknown });
    repos.referrals.create(PHONES.gustavo, PHONES.beta, "CODE1");
    repos.referrals.create(PHONES.gustavo, PHONES.unknown, "CODE1");
    repos.referrals.activate(PHONES.beta);
    const counts = repos.referrals.countByReferrer(PHONES.gustavo);
    assert.equal(counts.total, 2);
    assert.equal(counts.active, 1);
    assert.equal(counts.pending, 1);
  });

  it("getById returns referral", () => {
    repos.referrals.create(PHONES.gustavo, PHONES.beta, "CODE1");
    const ref = repos.referrals.getByReferred(PHONES.beta);
    const byId = repos.referrals.getById(ref.id);
    assert.equal(byId.id, ref.id);
    assert.equal(byId.referrer_phone, PHONES.gustavo);
  });

  it("getPendingRewards returns activated referrals", () => {
    repos.referrals.create(PHONES.gustavo, PHONES.beta, "CODE1");
    repos.referrals.activate(PHONES.beta);
    const rewards = repos.referrals.getPendingRewards(PHONES.gustavo);
    assert.equal(rewards.length, 1);
    assert.equal(rewards[0].referred_phone, PHONES.beta);
  });
});
