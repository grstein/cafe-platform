import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createLogger } from "../../../shared/lib/logger.mjs";
import { extractStageTimings } from "../../../consumers/analytics.mjs";

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

describe("analytics extractStageTimings", () => {
  it("returns null for missing or too-short timings", () => {
    assert.equal(extractStageTimings(null), null);
    assert.equal(extractStageTimings({}), null);
    assert.equal(extractStageTimings({ a: "2026-01-01T00:00:00Z" }), null);
  });

  it("computes per-stage deltas and end_to_end", () => {
    const timings = {
      incoming_to_validated: "2026-01-01T00:00:00.000Z",
      validated_to_ready:    "2026-01-01T00:00:02.500Z",
      ready_to_enriched:     "2026-01-01T00:00:02.600Z",
      enriched_to_response:  "2026-01-01T00:00:07.000Z",
    };
    const out = extractStageTimings(timings);
    assert.equal(out.end_to_end, 7000);
    assert.equal(out.stages.validated_to_ready, 2500);
    assert.equal(out.stages.ready_to_enriched, 100);
    assert.equal(out.stages.enriched_to_response, 4400);
  });

  it("sorts out-of-order timings before diffing", () => {
    const timings = {
      enriched_to_response:  "2026-01-01T00:00:05.000Z",
      incoming_to_validated: "2026-01-01T00:00:00.000Z",
      ready_to_enriched:     "2026-01-01T00:00:02.000Z",
    };
    const out = extractStageTimings(timings);
    assert.equal(out.end_to_end, 5000);
  });

  it("drops non-parseable timings", () => {
    const timings = {
      incoming_to_validated: "2026-01-01T00:00:00.000Z",
      bogus:                 "not a date",
      enriched_to_response:  "2026-01-01T00:00:04.000Z",
    };
    const out = extractStageTimings(timings);
    assert.equal(out.end_to_end, 4000);
  });
});
