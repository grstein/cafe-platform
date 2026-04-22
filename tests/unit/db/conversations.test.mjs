import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos } from "../../helpers/db.mjs";

describe("conversations repo", () => {
  let db, repos;
  beforeEach(() => { db = createTestDB(); repos = createTestRepos(db); });

  it("addMessage inserts user and assistant messages", () => {
    repos.conversations.addMessage("55", "user", "Quero cafe");
    repos.conversations.addMessage("55", "assistant", "Temos 3 opcoes!");
    const msgs = repos.conversations.getRecent("55", 30);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[1].role, "assistant");
  });

  it("addMessage with tool_name", () => {
    repos.conversations.addMessage("55", "tool_call", '{"name":"search"}', "search_catalog");
    const msgs = repos.conversations.getRecent("55", 30);
    assert.equal(msgs[0].tool_name, "search_catalog");
  });

  it("getCount returns correct count", () => {
    repos.conversations.addMessage("55", "user", "a");
    repos.conversations.addMessage("55", "user", "b");
    repos.conversations.addMessage("55", "user", "c");
    assert.equal(repos.conversations.getCount("55", 30), 3);
    assert.equal(repos.conversations.getCount("99", 30), 0);
  });

  it("getLastN returns most recent N messages", () => {
    repos.conversations.addMessage("55", "user", "first");
    repos.conversations.addMessage("55", "user", "second");
    repos.conversations.addMessage("55", "user", "third");
    const last2 = repos.conversations.getLastN("55", 2);
    assert.equal(last2.length, 2);
    // last 2 by id DESC reversed: should contain second+third (not first)
    const contents = last2.map(m => m.content);
    assert.ok(!contents.includes("first"), "should not include oldest message");
  });
});
