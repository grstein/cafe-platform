/**
 * @fileoverview Test helper — in-memory SQLite databases for unit tests.
 */

import Database from "better-sqlite3";
import { migrations } from "../../shared/db/migrations.mjs";
import { createCustomerRepo } from "../../shared/db/customers.mjs";
import { createProductRepo } from "../../shared/db/products.mjs";
import { createOrderRepo } from "../../shared/db/orders.mjs";
import { createCartRepo } from "../../shared/db/cart.mjs";
import { createReferralRepo } from "../../shared/db/referrals.mjs";
import { createConversationRepo } from "../../shared/db/conversations.mjs";
import { PRODUCTS } from "./fixtures.mjs";

/**
 * Create an in-memory SQLite database with all migrations applied.
 * Each call returns a fresh, isolated database.
 *
 * @returns {import('better-sqlite3').Database}
 */
export function createTestDB() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const insertVersion = db.prepare("INSERT INTO schema_version (version) VALUES (?)");
  for (const migration of migrations) {
    db.transaction(() => {
      migration.up(db);
      insertVersion.run(migration.version);
    })();
  }

  return db;
}

/**
 * Create all repository instances for a test database.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ customers, products, orders, cart, referrals, conversations }}
 */
export function createTestRepos(db) {
  return {
    customers: createCustomerRepo(db),
    products: createProductRepo(db),
    orders: createOrderRepo(db),
    cart: createCartRepo(db),
    referrals: createReferralRepo(db),
    conversations: createConversationRepo(db),
  };
}

/**
 * Seed the database with the 3 standard test products.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function seedProducts(db) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO products (sku, name, roaster, sca_score, profile, origin, process, price, cost, weight, available, stock, highlight, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 100, ?, datetime('now'))
  `);

  for (const p of Object.values(PRODUCTS)) {
    stmt.run(p.sku, p.name, p.roaster, p.sca, p.profile, p.origin, p.process, p.price, p.cost, p.weight, p.highlight);
  }
}

/**
 * Seed a customer with default or overridden data.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [overrides]
 * @returns {object} The created customer
 */
export function seedCustomer(db, overrides = {}) {
  const repos = createTestRepos(db);
  const phone = overrides.phone || "5541999990000";
  repos.customers.upsert(phone, { push_name: overrides.pushName || "TestUser" });
  if (overrides.name) repos.customers.updateInfo(phone, { name: overrides.name });
  if (overrides.cep) repos.customers.updateInfo(phone, { cep: overrides.cep });
  if (overrides.accessStatus) repos.customers.setAccessStatus(phone, overrides.accessStatus);
  return repos.customers.getByPhone(phone);
}
