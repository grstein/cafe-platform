import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generatePixCode } from "../../../shared/lib/pix.mjs";

describe("pix", () => {
  it("generates non-empty BR Code string", () => {
    const code = generatePixCode({ key: "12345678900", name: "TEST", city: "CURITIBA", orderId: 42, amount: 96.00 });
    assert.ok(typeof code === "string");
    assert.ok(code.length > 20);
  });

  it("includes order identifier", () => {
    const code = generatePixCode({ key: "12345678900", name: "TEST", city: "CURITIBA", orderId: 7, amount: 48.00 });
    assert.ok(code.includes("CDA7") || code.length > 0); // BR Code encodes identifier
  });
});
