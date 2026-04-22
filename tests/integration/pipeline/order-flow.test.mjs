import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts, seedCustomer } from "../../helpers/db.mjs";
import { PHONES, PIX_CONFIG } from "../../helpers/fixtures.mjs";
import { createCartTools } from "../../../shared/tools/cart-tools.mjs";
import { createCommandHandlers } from "../../../shared/commands/index.mjs";

describe("order flow integration", () => {
  let db, repos, cartTools, handlers;
  const phone = PHONES.gustavo;
  const findTool = (name) => cartTools.find(t => t.name === name);

  beforeEach(() => {
    db = createTestDB();
    repos = createTestRepos(db);
    seedProducts(db);
    seedCustomer(db, { phone, name: "Alice" });
    cartTools = createCartTools(phone, repos);
    handlers = createCommandHandlers(repos, PIX_CONFIG, { botPhone: "554100000000" });
  });

  it("add_to_cart → checkout → /confirma → PIX generated", async () => {
    // Step 1: Add to cart
    const addResult = await findTool("add_to_cart").execute("c1", {
      sku: "CDA-MOKA-MRCHOC-250", qty: 2,
    });
    assert.ok(!addResult.details.error);
    assert.equal(addResult.details.subtotal, 96);

    // Step 2: Checkout
    const checkoutResult = await findTool("checkout").execute("c1", {
      customer_name: "Alice Demo", cep: "80250-104",
    });
    assert.ok(checkoutResult.details.orderId);
    assert.equal(checkoutResult.details.total, 96);

    // Verify cart is cleared
    assert.equal(repos.cart.getSummary(phone).count, 0);

    // Step 3: /confirma
    const confirma = handlers.tryHandle("/confirma", phone);
    assert.equal(confirma.command, "confirma");
    assert.ok(confirma.text.includes("confirmado"));
    assert.ok(Array.isArray(confirma.messages));
    assert.equal(confirma.messages.length, 2);

    // Verify order is confirmed
    const order = repos.orders.getPending(phone);
    assert.equal(order, undefined);
  });

  it("add_to_cart → /cancelar clears order", async () => {
    await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 1 });
    await findTool("checkout").execute("c1", { customer_name: "Alice" });
    const cancel = handlers.tryHandle("/cancelar", phone);
    assert.ok(cancel.text.includes("cancelado"));
    assert.equal(repos.orders.getPending(phone), undefined);
  });
});
