/**
 * @fileoverview Test helper — PostgreSQL database for tests.
 *
 * createTestDB() connects to the test database, runs migrations,
 * and truncates all tables so each test file starts clean.
 */

import postgres from "postgres";
import { runMigrations } from "../../shared/db/migrations.mjs";
import { createAllowlistRepo } from "../../shared/db/allowlist.mjs";
import { createCustomerRepo } from "../../shared/db/customers.mjs";
import { createProductRepo } from "../../shared/db/products.mjs";
import { createOrderRepo } from "../../shared/db/orders.mjs";
import { createCartRepo } from "../../shared/db/cart.mjs";
import { createReferralRepo } from "../../shared/db/referrals.mjs";
import { createConversationRepo } from "../../shared/db/conversations.mjs";
import { PRODUCTS } from "./fixtures.mjs";

const TEST_DB_URL = process.env.DATABASE_URL || "postgresql://cafe_test:test@localhost:5432/cafe_test";

/**
 * Create a postgres.js client for tests.
 * Runs migrations and truncates data tables.
 *
 * @returns {Promise<import('postgres').Sql>}
 */
export async function createTestDB() {
  const sql = postgres(TEST_DB_URL, {
    max: 5,
    transform: {
      value: { from: (v) => (v instanceof Date ? v.toISOString() : v) },
    },
  });

  await runMigrations(sql);

  // Clean all data tables + reset config
  await sql`TRUNCATE TABLE referrals, conversations, cart_items, orders, customers, products, allowlist RESTART IDENTITY CASCADE`;
  await sql`DELETE FROM app_config`;
  // Re-seed app_config with test values
  const testConfig = {
    display_name: "Test Store",
    llm:          { provider: "openrouter", model: "anthropic/claude-haiku-4.5", thinking: "medium" },
    session:      { ttl_minutes: 30, soft_limit: 40, hard_limit: 60, debounce_ms: 2500 },
    behavior:     { humanize_delay_min_ms: 2000, humanize_delay_max_ms: 6000, rate_limit_per_min: 8, typing_indicator: true },
    pix:          { enabled: true },
    bot_phone:    "5500000000000",
    available_models: [
      { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", emoji: "🐇" },
      { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", emoji: "🧠" },
    ],
  };
  await sql`INSERT INTO app_config (id, config) VALUES (1, ${JSON.stringify(testConfig)}::jsonb)`;

  return sql;
}

/**
 * Create all repository instances for a test database.
 *
 * @param {import('postgres').Sql} sql
 */
export function createTestRepos(sql) {
  return {
    customers:     createCustomerRepo(sql),
    products:      createProductRepo(sql),
    orders:        createOrderRepo(sql),
    cart:          createCartRepo(sql),
    referrals:     createReferralRepo(sql),
    conversations: createConversationRepo(sql),
    allowlist:     createAllowlistRepo(sql),
  };
}

/**
 * Seed the database with the 3 standard test products.
 *
 * @param {import('postgres').Sql} sql
 */
export async function seedProducts(sql) {
  const repo = createProductRepo(sql);
  for (const p of Object.values(PRODUCTS)) {
    await repo.upsert({
      sku:       p.sku,
      name:      p.name,
      roaster:   p.roaster,
      sca_score: p.sca,
      profile:   p.profile,
      origin:    p.origin,
      process:   p.process,
      price:     p.price,
      cost:      p.cost,
      weight:    p.weight,
      available: true,
      stock:     100,
      highlight: p.highlight,
    });
  }
}

/**
 * Seed a customer with default or overridden data.
 *
 * @param {import('postgres').Sql} sql
 * @param {object} [overrides]
 * @returns {Promise<object>}
 */
export async function seedCustomer(sql, overrides = {}) {
  const repos = createTestRepos(sql);
  const phone = overrides.phone || "5541999990000";
  await repos.customers.upsert(phone, { push_name: overrides.pushName || "TestUser" });
  if (overrides.name)         await repos.customers.updateInfo(phone, { name: overrides.name });
  if (overrides.cep)          await repos.customers.updateInfo(phone, { cep: overrides.cep });
  if (overrides.accessStatus) await repos.customers.setAccessStatus(phone, overrides.accessStatus);
  return repos.customers.getByPhone(phone);
}
