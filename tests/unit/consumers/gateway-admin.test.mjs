import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Mirror of admin-detection logic in consumers/gateway.mjs. Keeping it here
// (instead of importing) matches the convention of the sibling gateway test.

function isAdminMessage({ fromMe, phone, botPhone }) {
  return fromMe === true && !!botPhone && phone === botPhone;
}

describe("gateway admin detection", () => {
  const BOT = "5500000000000";

  it("flags self-chat fromMe as admin", () => {
    assert.equal(isAdminMessage({ fromMe: true, phone: BOT, botPhone: BOT }), true);
  });

  it("does NOT flag fromMe to a different remote", () => {
    // Bot's own outgoing reply: fromMe=true, phone=customer
    assert.equal(isAdminMessage({ fromMe: true, phone: "5541999999999", botPhone: BOT }), false);
  });

  it("does NOT flag normal customer message", () => {
    assert.equal(isAdminMessage({ fromMe: false, phone: "5541999999999", botPhone: BOT }), false);
  });

  it("does NOT flag when BOT_PHONE is unset (fail closed)", () => {
    assert.equal(isAdminMessage({ fromMe: true, phone: BOT, botPhone: "" }), false);
  });

  it("does NOT flag when fromMe is omitted", () => {
    assert.equal(isAdminMessage({ phone: BOT, botPhone: BOT }), false);
  });

  it("does NOT flag a spoofed phone matching BOT but fromMe=false", () => {
    // Hypothetical: someone whose phone happens to equal BOT_PHONE without
    // fromMe. Since fromMe is server-signed by WhatsApp, this combination
    // cannot occur for a different account in practice — verify we still
    // require both flags.
    assert.equal(isAdminMessage({ fromMe: false, phone: BOT, botPhone: BOT }), false);
  });
});
