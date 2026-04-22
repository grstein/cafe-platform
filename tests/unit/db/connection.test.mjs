import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB } from "../../helpers/db.mjs";
import { runMigrations, migrations } from "../../../shared/db/migrations.mjs";

describe("connection manager (PostgreSQL)", () => {
  let sql;

  before(async () => {
    sql = await createTestDB();
  });

  after(async () => { await sql.end(); });

  it("createTestDB connects and runs migrations", async () => {
    const [row] = await sql`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`;
    assert.equal(Number(row.v), migrations[migrations.length - 1].version);
  });

  it("migrations are idempotent — running again does not fail", async () => {
    // Should not throw even if all migrations are already applied
    await runMigrations(sql);
    const [row] = await sql`SELECT COUNT(*)::int AS c FROM schema_version`;
    assert.ok(row.c >= migrations.length);
  });

  it("all expected tables exist", async () => {
    const tables = ["customers", "products", "orders", "cart_items", "conversations", "referrals"];
    for (const table of tables) {
      const [row] = await sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${table}
      `;
      assert.ok(row, `Table "${table}" should exist`);
    }
  });
});
