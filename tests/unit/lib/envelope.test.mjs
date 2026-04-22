import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createEnvelope, addMessage, setStage,
  enrichContext, setResponse, parseFromRabbitMQ,
} from "../../../shared/lib/envelope.mjs";

describe("envelope", () => {
  it("createEnvelope generates unique ids and correct fields", () => {
    const e = createEnvelope({ phone: "123", text: "hi", pushName: "Jo" });
    assert.ok(e.id);
    assert.ok(e.correlation_id);
    assert.notEqual(e.id, e.correlation_id);
    assert.equal(e.phone, "123");
    assert.equal(e.payload.merged_text, "hi");
    assert.equal(e.payload.batch_count, 1);
    assert.equal(e.payload.is_batch, false);
    assert.equal(e.metadata.stage, "incoming");
  });

  it("createEnvelope defaults channel to whatsapp", () => {
    const e = createEnvelope({ phone: "1", text: "x" });
    assert.equal(e.channel, "whatsapp");
  });

  it("addMessage accumulates and updates merged_text", () => {
    const e = createEnvelope({ phone: "1", text: "first" });
    addMessage(e, { text: "second" });
    addMessage(e, { text: "third" });
    assert.equal(e.payload.messages.length, 3);
    assert.equal(e.payload.merged_text, "first\nsecond\nthird");
    assert.equal(e.payload.is_batch, true);
    assert.equal(e.payload.batch_count, 3);
  });

  it("setStage updates metadata.stage", () => {
    const e = createEnvelope({ phone: "1", text: "x" });
    setStage(e, "validated");
    assert.equal(e.metadata.stage, "validated");
  });

  it("enrichContext adds key to context", () => {
    const e = createEnvelope({ phone: "1", text: "x" });
    enrichContext(e, "customer", { name: "Jo" });
    assert.deepEqual(e.context.customer, { name: "Jo" });
  });

  it("setResponse sets text and messages", () => {
    const e = createEnvelope({ phone: "1", text: "x" });
    setResponse(e, "reply", ["msg1", "msg2"]);
    assert.equal(e.payload.response_text, "reply");
    assert.deepEqual(e.payload.response_messages, ["msg1", "msg2"]);
  });

  it("parseFromRabbitMQ parses valid JSON buffer", () => {
    const data = { id: "test", phone: "123" };
    const msg = { content: Buffer.from(JSON.stringify(data)) };
    const parsed = parseFromRabbitMQ(msg);
    assert.deepEqual(parsed, data);
  });

  it("parseFromRabbitMQ throws on invalid JSON", () => {
    const msg = { content: Buffer.from("not json") };
    assert.throws(() => parseFromRabbitMQ(msg), SyntaxError);
  });
});
