/**
 * @fileoverview PostgreSQL connection manager.
 *
 * Returns a cached postgres.js client. Timestamps are returned as ISO
 * strings (not Date objects) via the value transformer.
 *
 * Call initDB() once at consumer startup to run pending migrations.
 */

import postgres from "postgres";
import { runMigrations } from "./migrations.mjs";

let _sql = null;

/**
 * Get (or create) the postgres.js client singleton.
 *
 * @param {string} [url] - PostgreSQL connection URL. Defaults to DATABASE_URL env.
 * @returns {import('postgres').Sql}
 */
export function getDB(url) {
  if (_sql) return _sql;

  const connectionUrl = url || process.env.DATABASE_URL;
  if (!connectionUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  _sql = postgres(connectionUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    // Return Date objects as ISO strings so downstream code stays unchanged
    transform: {
      value: { from: (v) => (v instanceof Date ? v.toISOString() : v) },
    },
  });

  return _sql;
}

/**
 * Run all pending migrations. Call once at consumer startup.
 *
 * @param {string} [url]
 * @returns {Promise<void>}
 */
export async function initDB(url) {
  const sql = getDB(url);
  await runMigrations(sql);
}

/**
 * Close the database connection (useful in tests or graceful shutdown).
 *
 * @returns {Promise<void>}
 */
export async function closeDB() {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}

/** Alias kept for backward compatibility. */
export const closeAll = closeDB;
