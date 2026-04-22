import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Extract pure functions from sender.mjs
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function resolveMessages(envelope) {
  const cmdResult = envelope.metadata?.command_result;
  const responseMessages = envelope.payload?.response_messages;
  const responseText = envelope.payload?.response_text;

  if (cmdResult?.messages) return cmdResult.messages;
  if (responseMessages && Array.isArray(responseMessages)) return responseMessages;
  if (responseText) return [responseText];
  if (cmdResult?.text) return [cmdResult.text];
  return [];
}

describe("sender internals", () => {
  it("randomDelay returns value in range", () => {
    for (let i = 0; i < 100; i++) {
      const d = randomDelay(2000, 6000);
      assert.ok(d >= 2000 && d <= 6000);
    }
  });

  it("randomDelay with same min/max returns that value", () => {
    assert.equal(randomDelay(500, 500), 500);
  });

  it("resolveMessages from command_result.messages (multi-message PIX)", () => {
    const env = {
      metadata: { command_result: { messages: ["Pedido confirmado!", "PIX-CODE-HERE"] } },
      payload: {},
    };
    const msgs = resolveMessages(env);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[1], "PIX-CODE-HERE");
  });

  it("resolveMessages from response_messages array", () => {
    const env = {
      metadata: {},
      payload: { response_messages: ["msg1", "msg2"] },
    };
    assert.equal(resolveMessages(env).length, 2);
  });

  it("resolveMessages from response_text (single)", () => {
    const env = { metadata: {}, payload: { response_text: "Hello" } };
    const msgs = resolveMessages(env);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0], "Hello");
  });

  it("resolveMessages from command_result.text", () => {
    const env = {
      metadata: { command_result: { text: "Ajuda..." } },
      payload: {},
    };
    assert.equal(resolveMessages(env)[0], "Ajuda...");
  });

  it("resolveMessages empty when no content", () => {
    assert.equal(resolveMessages({ metadata: {}, payload: {} }).length, 0);
  });
});
