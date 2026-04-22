import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedCustomer } from "../../helpers/db.mjs";
import { PHONES, TENANT_CONFIG } from "../../helpers/fixtures.mjs";
import { createReferralTools } from "../../../shared/tools/referral-tools.mjs";

describe("referral tools", () => {
  let repos, tools;
  const phone = PHONES.gustavo;
  const findTool = (name) => tools.find(t => t.name === name);

  beforeEach(() => {
    const db = createTestDB();
    repos = createTestRepos(db);
    seedCustomer(db, { phone });
    tools = createReferralTools(phone, repos, TENANT_CONFIG.bot_phone);
  });

  it("invite_customer creates referral", async () => {
    const r = await findTool("invite_customer").execute("c1", {
      invited_phone: PHONES.unknown,
      invited_name: "João",
    });
    assert.ok(r.content[0].text.includes("liberado"));
    const ref = repos.referrals.getByReferred(PHONES.unknown);
    assert.ok(ref);
    assert.equal(ref.referrer_phone, phone);
  });

  it("invite_customer for existing customer", async () => {
    repos.customers.upsert(PHONES.beta, { push_name: "Beta" });
    repos.customers.setAccessStatus(PHONES.beta, "active");
    const r = await findTool("invite_customer").execute("c1", {
      invited_phone: PHONES.beta,
    });
    assert.ok(r.details.alreadyExists);
  });

  it("get_referral_info returns code and counts", async () => {
    const r = await findTool("get_referral_info").execute("c1", {});
    assert.ok(r.content[0].text.includes("TEST-"));
    assert.ok(r.details.code);
    assert.ok(r.details.link);
    assert.ok(r.details.counts !== undefined);
  });
});
