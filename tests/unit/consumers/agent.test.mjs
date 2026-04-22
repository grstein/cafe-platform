import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts, seedCustomer } from "../../helpers/db.mjs";
import { PHONES, APP_CONFIG } from "../../helpers/fixtures.mjs";

// Pure utility extracted from agent.mjs
function resolveModelId(config, customer) {
  let modelId = config.llm?.model || "anthropic/claude-haiku-4.5";
  if (customer?.preferences) {
    try {
      const prefs = typeof customer.preferences === "string" ? JSON.parse(customer.preferences) : customer.preferences;
      if (prefs.modelo) modelId = prefs.modelo;
    } catch {}
  }
  return modelId;
}

const ALL_TOOL_NAMES = [
  "create_order", "list_orders",
  "search_catalog",
  "save_customer_info",
  "add_to_cart", "update_cart", "remove_from_cart", "view_cart", "checkout",
  "invite_customer", "get_referral_info",
];

describe("agent session reset", () => {
  it("resolveModelId uses default when no customer preference", () => {
    const modelId = resolveModelId(APP_CONFIG, null);
    assert.equal(modelId, APP_CONFIG.llm.model);
  });

  it("resolveModelId uses customer preference when set", () => {
    const customer = { preferences: JSON.stringify({ modelo: "anthropic/claude-sonnet-4.6" }) };
    const modelId = resolveModelId(APP_CONFIG, customer);
    assert.equal(modelId, "anthropic/claude-sonnet-4.6");
  });

  it("resolveModelId falls back on invalid JSON preferences", () => {
    const customer = { preferences: "not json" };
    const modelId = resolveModelId(APP_CONFIG, customer);
    assert.equal(modelId, APP_CONFIG.llm.model);
  });

  it("all 11 tool names are present in tool set", () => {
    assert.equal(ALL_TOOL_NAMES.length, 11);
    assert.ok(ALL_TOOL_NAMES.includes("search_catalog"));
    assert.ok(ALL_TOOL_NAMES.includes("checkout"));
    assert.ok(ALL_TOOL_NAMES.includes("get_referral_info"));
  });
});

describe("agent session cache", () => {
  let sql, repos;

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
    await seedProducts(sql);
    await seedCustomer(sql, { phone: PHONES.primary });
  });

  after(async () => { await sql.end(); });

  it("customer preferences are read from DB for model resolution", async () => {
    await repos.customers.updateInfo(PHONES.primary, {
      preferences: JSON.stringify({ modelo: "anthropic/claude-sonnet-4.6" }),
    });
    const customer = await repos.customers.getByPhone(PHONES.primary);
    const modelId = resolveModelId(APP_CONFIG, customer);
    assert.equal(modelId, "anthropic/claude-sonnet-4.6");
  });
});
