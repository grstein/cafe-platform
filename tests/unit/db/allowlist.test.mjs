import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos } from "../../helpers/db.mjs";

describe("allowlist repo", () => {
  let sql, repos;

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
  });

  after(async () => { await sql.end(); });

  it("addPattern inserts a pattern", async () => {
    await repos.allowlist.addPattern("5541999990001", "test entry");
    const patterns = await repos.allowlist.getPatterns();
    assert.ok(patterns.some(p => p.pattern === "5541999990001"));
  });

  it("addPattern with wildcard", async () => {
    await repos.allowlist.addPattern("5541*", "all DDD 41");
    const patterns = await repos.allowlist.getPatterns();
    assert.ok(patterns.some(p => p.pattern === "5541*"));
  });

  it("removePattern deactivates pattern", async () => {
    await repos.allowlist.addPattern("5500000000099", "temp");
    await repos.allowlist.removePattern("5500000000099");
    const patterns = await repos.allowlist.getPatterns();
    assert.ok(!patterns.some(p => p.pattern === "5500000000099"));
  });

  it("addPattern re-activates deactivated pattern", async () => {
    await repos.allowlist.addPattern("5500000000088", "first");
    await repos.allowlist.removePattern("5500000000088");
    await repos.allowlist.addPattern("5500000000088", "re-added");
    const patterns = await repos.allowlist.getPatterns();
    assert.ok(patterns.some(p => p.pattern === "5500000000088"));
  });

  it("listAll includes inactive patterns", async () => {
    await repos.allowlist.addPattern("5500000000077");
    await repos.allowlist.removePattern("5500000000077");
    const all = await repos.allowlist.listAll();
    const entry = all.find(p => p.pattern === "5500000000077");
    assert.ok(entry);
    assert.equal(entry.active, false);
  });

  it("seedFromFile skips when table already has patterns", async () => {
    // Table already has data from previous tests — seedFromFile should be a no-op
    const before = (await repos.allowlist.getPatterns()).length;
    await repos.allowlist.seedFromFile();
    const after = (await repos.allowlist.getPatterns()).length;
    assert.equal(before, after); // unchanged
  });
});
