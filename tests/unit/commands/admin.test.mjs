import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos } from "../../helpers/db.mjs";
import { createMockChannel } from "../../helpers/rabbitmq.mjs";
import { APP_CONFIG } from "../../helpers/fixtures.mjs";
import { tryHandleAdmin } from "../../../shared/commands/admin.mjs";
import { normalizeBrPhone } from "../../../shared/lib/phone.mjs";

const ADMIN_PHONE = "5500000000000";

describe("normalizeBrPhone", () => {
  it("prepends 55 when missing", () => {
    assert.equal(normalizeBrPhone("41999999999"), "5541999999999");
  });
  it("keeps full E.164 digits", () => {
    assert.equal(normalizeBrPhone("5541999999999"), "5541999999999");
  });
  it("strips non-digit chars", () => {
    assert.equal(normalizeBrPhone("(41) 99999-9999"), "5541999999999");
  });
  it("rejects too short", () => {
    assert.equal(normalizeBrPhone("123"), null);
  });
  it("rejects empty / non-string", () => {
    assert.equal(normalizeBrPhone(""), null);
    assert.equal(normalizeBrPhone(null), null);
  });
});

describe("tryHandleAdmin", () => {
  let sql, repos, channel, ctx;

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
  });
  after(async () => { await sql.end(); });

  beforeEach(async () => {
    await sql`TRUNCATE TABLE customers RESTART IDENTITY CASCADE`;
    channel = createMockChannel();
    ctx = { actor: "admin", phone: ADMIN_PHONE, repos, channel, config: APP_CONFIG };
  });

  it("returns null for non-admin text", async () => {
    assert.equal(await tryHandleAdmin("oi", ctx), null);
    assert.equal(await tryHandleAdmin("/ajuda", ctx), null);
  });

  it("/admin without args shows help menu", async () => {
    const r = await tryHandleAdmin("/admin", ctx);
    assert.equal(r.command, "/admin");
    assert.match(r.text, /autorizar/);
  });

  it("refuses when actor is not admin (defense in depth)", async () => {
    const noAdminCtx = { ...ctx, actor: "customer" };
    assert.equal(await tryHandleAdmin("/admin autorizar 41999999999", noAdminCtx), null);
  });

  it("/admin autorizar with no phone returns usage", async () => {
    const r = await tryHandleAdmin("/admin autorizar", ctx);
    assert.match(r.text, /Uso/);
  });

  it("/admin autorizar rejects invalid phone", async () => {
    const r = await tryHandleAdmin("/admin autorizar abc", ctx);
    assert.match(r.text, /inválido/i);
    assert.equal(channel.published.length, 0);
  });

  it("/admin autorizar refuses self-authorize", async () => {
    const r = await tryHandleAdmin(`/admin autorizar ${ADMIN_PHONE}`, ctx);
    assert.match(r.text, /você mesmo/);
    assert.equal(channel.published.length, 0);
  });

  it("/admin autorizar creates new active customer + publishes welcome", async () => {
    const r = await tryHandleAdmin("/admin autorizar 41999999999", ctx);
    assert.match(r.text, /^✓ 5541999999999/);
    assert.match(r.text, /autorizado/);

    const customer = await repos.customers.getByPhone("5541999999999");
    assert.equal(customer.access_status, "active");
    assert.equal(customer.referred_by_phone, "admin");

    assert.equal(channel.published.length, 1);
    const sent = channel.published[0];
    assert.equal(sent.exchange, "msg.flow");
    assert.equal(sent.routingKey, "send");
    assert.equal(sent.envelope.phone, "5541999999999");
    assert.equal(sent.envelope.action, "text");
    assert.match(sent.envelope.text, /\/ajuda/);
  });

  it("/admin autorizar is idempotent", async () => {
    await tryHandleAdmin("/admin autorizar 41999999999", ctx);
    channel.reset();
    const r = await tryHandleAdmin("/admin autorizar 41999999999", ctx);
    assert.match(r.text, /já estava autorizado/);
    assert.equal(channel.published.length, 1); // welcome resent
  });

  it("/admin autorizar preserves an existing referrer", async () => {
    const phone = "5541988888888";
    await repos.customers.upsert(phone, { access_status: "invited", referred_by_phone: "5541977777777" });
    await tryHandleAdmin(`/admin autorizar ${phone}`, ctx);
    const customer = await repos.customers.getByPhone(phone);
    assert.equal(customer.access_status, "active");
    assert.equal(customer.referred_by_phone, "5541977777777");
  });

  it("unknown /admin subcommand returns help", async () => {
    const r = await tryHandleAdmin("/admin foobar", ctx);
    assert.match(r.text, /desconhecido/i);
    assert.match(r.text, /autorizar/);
  });
});
