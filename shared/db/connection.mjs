/**
 * @fileoverview SQLite connection manager — single database per tenant.
 *
 * Returns a cached connection, auto-migrating on first access.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { migrations } from "./migrations.mjs";
import { getTenantId } from "../lib/config.mjs";

let _db = null;

/**
 * Get (or create) the SQLite database connection.
 *
 * @param {string} [dataDir] - Directory where the .db file lives. Defaults to DATA_DIR env or "./data".
 * @returns {import('better-sqlite3').Database}
 */
export function getDB(dataDir) {
  if (_db) return _db;

  const dir = dataDir || process.env.DATA_DIR || "./data";
  fs.mkdirSync(dir, { recursive: true });

  const dbPath = path.join(dir, `${getTenantId()}.db`);
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  _runMigrations(db);

  _db = db;
  return _db;
}

/**
 * Close the database connection (useful in tests or graceful shutdown).
 */
export function closeDB() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/** Alias kept for backward compatibility with tests. */
export const closeAll = closeDB;

function _runMigrations(db) {
  const row = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS current FROM schema_version")
    .get();
  const currentVersion = row.current;

  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) return;

  const insertVersion = db.prepare("INSERT INTO schema_version (version) VALUES (?)");
  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      insertVersion.run(migration.version);
    })();
  }
}
