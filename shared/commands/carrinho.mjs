/**
 * @fileoverview /carrinho command handler — async.
 *
 * Renderiza três estados: pedido pendente (precedência), carrinho com itens,
 * ou vazio. /pedido é alias deste handler.
 */

const ORDER_PREFIX = process.env.ORDER_PREFIX || "";

function formatOrderItems(order) {
  const items = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
  return items
    .map(i => `${i.qty}x ${i.name} — R$ ${(i.qty * Number(i.unit_price)).toFixed(2)}`)
    .join("\n");
}

export async function handleCarrinho(phone, repos) {
  const pending = repos.orders ? await repos.orders.getPending(phone) : null;
  if (pending) {
    const text = [
      `📋 Pedido pendente #${ORDER_PREFIX}${pending.id}:`,
      "",
      formatOrderItems(pending),
      `Total: R$ ${Number(pending.total).toFixed(2)}`,
      "",
      "Envie /confirma para pagar ou /cancelar para desistir.",
    ].join("\n");
    return { command: "carrinho", text };
  }

  const { items, subtotal, count } = await repos.cart.getSummary(phone);

  if (count === 0) {
    return {
      command: "carrinho",
      text: "Carrinho vazio! Me conta o que você procura e te ajudo a escolher ☕",
    };
  }

  const desc = items.map(i =>
    `${i.qty}x ${i.product_name || i.product_sku} — R$ ${(Number(i.qty) * Number(i.unit_price)).toFixed(2)}`
  ).join("\n");

  const text = [
    "🛒 Seu carrinho:",
    "",
    desc,
    "",
    `Subtotal: R$ ${subtotal.toFixed(2)}`,
    "",
    "Para fechar o pedido, me diga seu nome.",
  ].join("\n");

  return { command: "carrinho", text };
}
