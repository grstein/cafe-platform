import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createLogger } from "../../../shared/lib/logger.mjs";

describe("logger", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates JSONL file with correct date", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-test-"));
    const logger = createLogger(tmpDir);
    logger.log("MSG_IN", "5541999990000", { text: "oi" });
    const date = new Date().toISOString().slice(0, 10);
    assert.ok(fs.existsSync(path.join(tmpDir, `${date}.jsonl`)));
  });

  it("each line is valid JSON with required fields", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-test-"));
    const logger = createLogger(tmpDir);
    logger.log("MSG_IN", "5541999990000", { text: "hello" });
    const date = new Date().toISOString().slice(0, 10);
    const lines = fs.readFileSync(path.join(tmpDir, `${date}.jsonl`), "utf-8").trim().split("\n");
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.ok(entry.ts);
    assert.equal(entry.type, "MSG_IN");
    assert.equal(entry.phone, "5541999990000");
    assert.equal(entry.text, "hello");
  });

  it("multiple calls append to same file", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-test-"));
    const logger = createLogger(tmpDir);
    logger.log("MSG_IN", "55", {});
    logger.log("MSG_OUT", "55", {});
    logger.log("CMD", "55", {});
    const date = new Date().toISOString().slice(0, 10);
    const lines = fs.readFileSync(path.join(tmpDir, `${date}.jsonl`), "utf-8").trim().split("\n");
    assert.equal(lines.length, 3);
    lines.forEach(line => JSON.parse(line));
  });

  it("creates logDir if missing", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-test-"));
    const nested = path.join(tmpDir, "a", "b");
    const logger = createLogger(nested);
    logger.log("TEST", "55", {});
    assert.ok(fs.existsSync(nested));
  });
});
