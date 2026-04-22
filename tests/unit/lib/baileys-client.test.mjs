import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("baileys-client", () => {
  it("module exports createBaileysConnection", async () => {
    const mod = await import("../../../shared/lib/baileys-client.mjs");
    assert.equal(typeof mod.createBaileysConnection, "function");
  });
});
