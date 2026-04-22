import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedCustomer } from "../../helpers/db.mjs";
import { PHONES, APP_CONFIG } from "../../helpers/fixtures.mjs";
import { createReferralTools } from "../../../shared/tools/referral-tools.mjs";

describe("referral tools", () => {
  let sql, repos, tools;
  const phone = PHONES.primary;
  const findTool = (name) => tools.find(t => t.name === name);

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
    await seedCustomer(sql, { phone });
    tools = createReferralTools(phone, repos, APP_CONFIG.bot_phone);
  });

  after(async () => { await sql.end(); });

  it("invite_customer creates referral", async () => {
    const r = await findTool("invite_customer").execute("c1", {
      invited_phone: PHONES.unknown,
      invited_name: "João",
    });
    assert.ok(r.content[0].text.includes("liberado"));
    const ref = await repos.referrals.getByReferred(PHONES.unknown);
    assert.ok(ref);
    assert.equal(ref.referrer_phone, phone);
  });

  it("invite_customer for existing active customer", async () => {
    await repos.customers.upsert(PHONES.secondary, { push_name: "Beta" });
    await repos.customers.setAccessStatus(PHONES.secondary, "active");
    const r = await findTool("invite_customer").execute("c1", { invited_phone: PHONES.secondary });
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
