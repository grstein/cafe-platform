import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createLogger } from "../../../shared/lib/logger.mjs";

// Replicate analytics routing logic for testing (single logger, no tenant lookup)
function processAnalytics(envelope, logger) {
  const stage = envelope.metadata?.stage || "unknown";
  const phone = envelope.phone || "";
  const logged = [];

  switch (stage) {
    case "outgoing":
    case "response": {
      const cmdResult = envelope.metadata?.command_result;
      const responseText = envelope.payload?.response_text || cmdResult?.text || "";
      const isCommand = !!cmdResult;
      const type = isCommand ? "CMD_OUT" : "MSG_OUT";
      logger.log(type, phone, {
        text: responseText,
        command: cmdResult?.command,
        batch_count: envelope.payload?.batch_count || 1,
        correlation_id: envelope.correlation_id,
      });
      logged.push(type);

      if (envelope.payload?.merged_text) {
        logger.log("MSG_IN", phone, {
          text: envelope.payload.merged_text,
          pushName: envelope.payload.messages?.[0]?.pushName,
          batch_count: envelope.payload.batch_count,
        });
        logged.push("MSG_IN");
      }
      break;
    }
    default: {
      logger.log(stage.toUpperCase(), phone, { correlation_id: envelope.correlation_id });
      logged.push(stage.toUpperCase());
    }
  }
  return logged;
}

describe("analytics internals", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeLogger() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "analytics-test-"));
    return createLogger(tmpDir);
  }

  it("stage=response logs MSG_OUT and MSG_IN", () => {
    const logger = makeLogger();
    const logged = processAnalytics({
      phone: "55",
      correlation_id: "c1",
      metadata: { stage: "response" },
      payload: { response_text: "Oi!", merged_text: "Quero café" },
    }, logger);
    assert.deepEqual(logged, ["MSG_OUT", "MSG_IN"]);
    const date = new Date().toISOString().slice(0, 10);
    const lines = fs.readFileSync(path.join(tmpDir, `${date}.jsonl`), "utf-8").trim().split("\n");
    assert.equal(lines.length, 2);
  });

  it("command_result logs CMD_OUT", () => {
    const logger = makeLogger();
    const logged = processAnalytics({
      phone: "55",
      correlation_id: "c1",
      metadata: { stage: "response", command_result: { command: "ajuda", text: "Help" } },
      payload: {},
    }, logger);
    assert.equal(logged[0], "CMD_OUT");
  });

  it("stage=outgoing logs MSG_OUT", () => {
    const logger = makeLogger();
    const logged = processAnalytics({
      phone: "55",
      metadata: { stage: "outgoing" },
      payload: { response_text: "Oi!" },
    }, logger);
    assert.equal(logged[0], "MSG_OUT");
  });

  it("unknown stage logs the stage name uppercased", () => {
    const logger = makeLogger();
    const logged = processAnalytics({
      phone: "55",
      metadata: { stage: "completed" },
      payload: {},
    }, logger);
    assert.equal(logged[0], "COMPLETED");
  });
});
