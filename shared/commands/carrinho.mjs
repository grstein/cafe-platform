/**
 * @fileoverview /carrinho command handler — async.
 */

export async function handleCarrinho(phone, repos) {
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
