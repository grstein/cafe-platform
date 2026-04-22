import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos } from "../../helpers/db.mjs";

describe("conversations repo", () => {
  let sql, repos;

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
  });

  after(async () => { await sql.end(); });

  it("addMessage inserts user and assistant messages", async () => {
    await repos.conversations.addMessage("c55", "user", "Quero cafe");
    await repos.conversations.addMessage("c55", "assistant", "Temos 3 opcoes!");
    const msgs = await repos.conversations.getRecent("c55", 30);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[1].role, "assistant");
  });

  it("addMessage with tool_name", async () => {
    await repos.conversations.addMessage("c56", "tool_call", '{"name":"search"}', "search_catalog");
    const msgs = await repos.conversations.getRecent("c56", 30);
    assert.equal(msgs[0].tool_name, "search_catalog");
  });

  it("getCount returns correct count", async () => {
    await repos.conversations.addMessage("c57", "user", "a");
    await repos.conversations.addMessage("c57", "user", "b");
    await repos.conversations.addMessage("c57", "user", "c");
    assert.equal(await repos.conversations.getCount("c57", 30), 3);
    assert.equal(await repos.conversations.getCount("c99999", 30), 0);
  });

  it("getLastN returns most recent N messages", async () => {
    await repos.conversations.addMessage("c58", "user", "first");
    await repos.conversations.addMessage("c58", "user", "second");
    await repos.conversations.addMessage("c58", "user", "third");
    const last2 = await repos.conversations.getLastN("c58", 2);
    assert.equal(last2.length, 2);
    const contents = last2.map(m => m.content);
    assert.ok(!contents.includes("first"), "should not include oldest message");
  });
});
