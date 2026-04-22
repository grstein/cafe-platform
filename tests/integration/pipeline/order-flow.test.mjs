import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedProducts, seedCustomer } from "../../helpers/db.mjs";
import { PHONES, PIX_CONFIG } from "../../helpers/fixtures.mjs";
import { createCartTools } from "../../../shared/tools/cart-tools.mjs";
import { createCommandHandlers } from "../../../shared/commands/index.mjs";

describe("order flow integration", () => {
  let sql, repos, cartTools, handlers;
  const phone = PHONES.primary;
  const findTool = (name) => cartTools.find(t => t.name === name);

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
    await seedProducts(sql);
    await seedCustomer(sql, { phone, name: "Alice" });
    cartTools = createCartTools(phone, repos);
    handlers = createCommandHandlers(repos, PIX_CONFIG, { botPhone: "554100000000" });
  });

  after(async () => { await sql.end(); });

  it("add_to_cart → checkout → /confirma → PIX generated", async () => {
    await repos.cart.clear(phone);

    // Step 1: Add to cart
    const addResult = await findTool("add_to_cart").execute("c1", {
      sku: "CDA-MOKA-MRCHOC-250", qty: 2,
    });
    assert.ok(!addResult.details.error);
    assert.ok(Math.abs(addResult.details.subtotal - 96) < 0.01);

    // Step 2: Checkout
    const checkoutResult = await findTool("checkout").execute("c1", {
      customer_name: "Alice Demo", cep: "80250-104",
    });
    assert.ok(checkoutResult.details.orderId);
    assert.ok(Math.abs(checkoutResult.details.total - 96) < 0.01);

    // Cart is cleared
    const cart = await repos.cart.getSummary(phone);
    assert.equal(cart.count, 0);

    // Step 3: /confirma
    const confirma = await handlers.tryHandle("/confirma", phone);
    assert.equal(confirma.command, "confirma");
    assert.ok(confirma.text.includes("confirmado"));
    assert.ok(Array.isArray(confirma.messages));
    assert.ok(confirma.messages.length >= 2);

    // Order is confirmed
    const order = await repos.orders.getPending(phone);
    assert.equal(order, null);
  });

  it("add_to_cart → /cancelar clears pending order", async () => {
    await repos.cart.clear(phone);
    await findTool("add_to_cart").execute("c1", { sku: "CDA-MOKA-MRCHOC-250", qty: 1 });
    await findTool("checkout").execute("c1", { customer_name: "Alice" });
    const cancel = await handlers.tryHandle("/cancelar", phone);
    assert.ok(cancel.text.includes("cancelado"));
    assert.equal(await repos.orders.getPending(phone), null);
  });
});
