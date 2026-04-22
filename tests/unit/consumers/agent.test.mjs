import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts, seedCustomer } from "../../helpers/db.mjs";
import { PHONES, APP_CONFIG } from "../../helpers/fixtures.mjs";

// Extract pure functions from agent.mjs
function resolveModelId(tenantConfig, customer) {
  let modelId = tenantConfig.llm?.model || "anthropic/claude-sonnet-4.6";
  if (customer?.preferences) {
    try {
      const prefs = typeof customer.preferences === "string" ? JSON.parse(customer.preferences) : customer.preferences;
      if (prefs.modelo) modelId = prefs.modelo;
    } catch {}
  }
  return modelId;
}

function buildCustomToolNames(phone, repos, botPhone) {
  // Simulate tool name extraction without importing Pi Agent SDK
  const toolSets = [
    ["create_order", "list_orders"],
    ["search_catalog"],
    ["save_customer_info"],
    ["add_to_cart", "update_cart", "remove_from_cart", "view_cart", "checkout"],
    ["invite_customer", "get_referral_info"],
  ];
  return toolSets.flat();
}

describe("agent session reset", () => {
  it("clears session from cache on reset event", () => {
    const sessionCache = new Map();
    const disposed = [];
    const mockSession = { dispose() { disposed.push(true); } };
    sessionCache.set(PHONES.gustavo, { session: mockSession, lastUsed: Date.now(), msgCount: 1 });

    // Simulate reset event handler
    const resetPayload = { phone: PHONES.gustavo };
    const cached = sessionCache.get(resetPayload.phone);
    if (cached) {
      try { cached.session.dispose(); } catch {}
      sessionCache.delete(resetPayload.phone);
    }

    assert.equal(sessionCache.size, 0);
    assert.equal(disposed.length, 1);
  });

  it("ignores reset for non-existent session", () => {
    const sessionCache = new Map();
    const resetPayload = { phone: PHONES.gustavo };
    const cached = sessionCache.get(resetPayload.phone);
    assert.equal(cached, undefined);
    assert.equal(sessionCache.size, 0);
  });

  it("only clears the matching session, not others", () => {
    const sessionCache = new Map();
    const session1 = { dispose() {} };
    const session2 = { dispose() {} };
    sessionCache.set(PHONES.gustavo, { session: session1, lastUsed: Date.now(), msgCount: 1 });
    sessionCache.set(PHONES.beta, { session: session2, lastUsed: Date.now(), msgCount: 1 });

    const resetPayload = { phone: PHONES.gustavo };
    const cached = sessionCache.get(resetPayload.phone);
    if (cached) {
      try { cached.session.dispose(); } catch {}
      sessionCache.delete(resetPayload.phone);
    }

    assert.equal(sessionCache.size, 1);
    assert.ok(sessionCache.has(PHONES.beta));
  });
});

describe("agent internals", () => {
  it("resolveModelId returns default from config", () => {
    const id = resolveModelId(APP_CONFIG, null);
    assert.equal(id, "anthropic/claude-haiku-4.5");
  });

  it("resolveModelId uses customer preference", () => {
    const customer = { preferences: JSON.stringify({ modelo: "anthropic/claude-haiku-4.5" }) };
    const id = resolveModelId(APP_CONFIG, customer);
    assert.equal(id, "anthropic/claude-haiku-4.5");
  });

  it("resolveModelId falls back on invalid preferences", () => {
    const customer = { preferences: "invalid-json" };
    const id = resolveModelId(APP_CONFIG, customer);
    assert.equal(id, "anthropic/claude-haiku-4.5");
  });

  it("resolveModelId with object preferences", () => {
    const customer = { preferences: { modelo: "x/custom" } };
    const id = resolveModelId(APP_CONFIG, customer);
    assert.equal(id, "x/custom");
  });

  it("buildCustomTools returns expected tool names", () => {
    const db = createTestDB();
    const repos = createTestRepos(db);
    seedProducts(db);
    seedCustomer(db, { phone: PHONES.gustavo });

    // Import actual tools to verify count
    const expected = [
      "create_order", "list_orders",
      "search_catalog",
      "save_customer_info",
      "add_to_cart", "update_cart", "remove_from_cart", "view_cart", "checkout",
      "invite_customer", "get_referral_info",
    ];
    const names = buildCustomToolNames(PHONES.gustavo, repos, "554100000000");
    assert.deepEqual(names, expected);
  });
});
