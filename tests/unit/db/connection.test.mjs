import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { getDB, closeDB, closeAll } from "../../../shared/db/connection.mjs";
import { migrations } from "../../../shared/db/migrations.mjs";
import { getTenantId } from "../../../shared/lib/config.mjs";

describe("connection manager", () => {
  let tmpDir;
  let origDataDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conn-test-"));
    origDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(() => {
    closeAll();
    if (origDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = origDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("getDB creates .db file for the single tenant", () => {
    getDB(tmpDir);
    assert.ok(fs.existsSync(path.join(tmpDir, `${getTenantId()}.db`)));
  });

  it("getDB returns cached instance", () => {
    const a = getDB(tmpDir);
    const b = getDB(tmpDir);
    assert.equal(a, b);
  });

  it("getDB runs all migrations", () => {
    const db = getDB(tmpDir);
    const row = db.prepare("SELECT MAX(version) AS v FROM schema_version").get();
    assert.equal(row.v, migrations[migrations.length - 1].version);
  });

  it("closeDB removes cached instance", () => {
    const a = getDB(tmpDir);
    closeDB();
    const b = getDB(tmpDir);
    assert.notEqual(a, b);
  });

  it("closeAll clears connection", () => {
    const a = getDB(tmpDir);
    closeAll();
    const b = getDB(tmpDir);
    assert.notEqual(a, b);
  });

  it("getDB creates dataDir recursively", () => {
    const nested = path.join(tmpDir, "a", "b", "c");
    getDB(nested);
    assert.ok(fs.existsSync(path.join(nested, `${getTenantId()}.db`)));
  });
});
