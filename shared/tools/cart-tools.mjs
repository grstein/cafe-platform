/**
 * @fileoverview Cart tools for the Pi Agent — async repos.
 */

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const ORDER_PREFIX = process.env.ORDER_PREFIX || "";

async function pendingOrderBlock(phone, repos) {
  const pending = await repos.orders.getPending(phone);
  if (!pending) return null;
  const text = `Cliente tem o pedido #${ORDER_PREFIX}${pending.id} aguardando pagamento (R$ ${Number(pending.total).toFixed(2)}). Peça para enviar /confirma para pagar ou /cancelar para desistir antes de montar um novo pedido.`;
  return { content: [{ type: "text", text }], details: { error: true, pendingOrderId: pending.id } };
}

export function createCartTools(phone, repos) {
  const addToCart = defineTool({
    name: "add_to_cart",
    label: "Adicionar ao Carrinho",
    description: "Adiciona um café ao carrinho do cliente.",
    promptSnippet: "Adiciona item ao carrinho (SKU + quantidade)",
    promptGuidelines: [
      "Sempre use search_catalog antes para confirmar SKU e preço.",
      "Após adicionar, informe o que está no carrinho e o subtotal.",
    ],
    parameters: Type.Object({
      sku: Type.String({ description: "SKU do produto" }),
      qty: Type.Optional(Type.Number({ description: "Quantidade (padrão: 1)" })),
    }),
    async execute(_toolCallId, params) {
      const blocked = await pendingOrderBlock(phone, repos);
      if (blocked) return blocked;
      const qty = params.qty || 1;
      const product = await repos.products.getBySku(params.sku);
      if (!product) return { content: [{ type: "text", text: `Erro: SKU "${params.sku}" não encontrado.` }], details: { error: true } };
      if (!product.available) return { content: [{ type: "text", text: `Erro: "${product.name}" não está disponível.` }], details: { error: true } };

      await repos.cart.addItem(phone, params.sku, qty, Number(product.price));
      const { items, subtotal, count } = await repos.cart.getSummary(phone);
      const desc = items.map(i => `${i.qty}x ${i.product_name || i.product_sku} — R$ ${(Number(i.qty) * Number(i.unit_price)).toFixed(2)}`).join("\n");
      return {
        content: [{ type: "text", text: `Item adicionado! Carrinho atual:\n\n${desc}\n\nSubtotal: R$ ${subtotal.toFixed(2)}\n${count} item(ns) no carrinho.` }],
        details: { sku: params.sku, qty, subtotal, count },
      };
    },
  });

  const updateCart = defineTool({
    name: "update_cart",
    label: "Atualizar Carrinho",
    description: "Altera a quantidade de um item no carrinho.",
    promptSnippet: "Altera quantidade de um item no carrinho",
    promptGuidelines: ["Use quando o cliente quiser mudar a quantidade de um item já no carrinho."],
    parameters: Type.Object({
      sku: Type.String({ description: "SKU do produto" }),
      qty: Type.Number({ description: "Nova quantidade (0 para remover)" }),
    }),
    async execute(_toolCallId, params) {
      if (params.qty <= 0) {
        await repos.cart.removeItem(phone, params.sku);
      } else {
        const updated = await repos.cart.updateQty(phone, params.sku, params.qty);
        if (!updated) return { content: [{ type: "text", text: `Item "${params.sku}" não está no carrinho.` }], details: { error: true } };
      }
      const { items, subtotal, count } = await repos.cart.getSummary(phone);
      if (count === 0) return { content: [{ type: "text", text: "Carrinho vazio." }], details: { count: 0 } };
      const desc = items.map(i => `${i.qty}x ${i.product_name || i.product_sku} — R$ ${(Number(i.qty) * Number(i.unit_price)).toFixed(2)}`).join("\n");
      return { content: [{ type: "text", text: `Carrinho atualizado:\n\n${desc}\n\nSubtotal: R$ ${subtotal.toFixed(2)}` }], details: { count, subtotal } };
    },
  });

  const removeFromCart = defineTool({
    name: "remove_from_cart",
    label: "Remover do Carrinho",
    description: "Remove um item do carrinho.",
    promptSnippet: "Remove item do carrinho por SKU",
    promptGuidelines: ["Use quando o cliente quiser tirar um item específico do carrinho."],
    parameters: Type.Object({ sku: Type.String({ description: "SKU do produto a remover" }) }),
    async execute(_toolCallId, params) {
      const removed = await repos.cart.removeItem(phone, params.sku);
      if (!removed) return { content: [{ type: "text", text: `Item "${params.sku}" não estava no carrinho.` }], details: { error: true } };
      const { items, subtotal, count } = await repos.cart.getSummary(phone);
      if (count === 0) return { content: [{ type: "text", text: "Item removido. Carrinho vazio agora." }], details: { count: 0 } };
      const desc = items.map(i => `${i.qty}x ${i.product_name || i.product_sku} — R$ ${(Number(i.qty) * Number(i.unit_price)).toFixed(2)}`).join("\n");
      return { content: [{ type: "text", text: `Item removido. Carrinho:\n\n${desc}\n\nSubtotal: R$ ${subtotal.toFixed(2)}` }], details: { count, subtotal } };
    },
  });

  const viewCart = defineTool({
    name: "view_cart",
    label: "Ver Carrinho",
    description: "Mostra o conteúdo atual do carrinho do cliente.",
    promptSnippet: "Mostra itens e subtotal do carrinho",
    promptGuidelines: ["Use quando o cliente perguntar o que tem no carrinho."],
    parameters: Type.Object({}),
    async execute() {
      const { items, subtotal, count } = await repos.cart.getSummary(phone);
      if (count === 0) return { content: [{ type: "text", text: "Carrinho vazio." }], details: { count: 0 } };
      const desc = items.map(i => `${i.qty}x ${i.product_name || i.product_sku} — R$ ${(Number(i.qty) * Number(i.unit_price)).toFixed(2)}`).join("\n");
      return { content: [{ type: "text", text: `Carrinho:\n\n${desc}\n\nSubtotal: R$ ${subtotal.toFixed(2)}\n\nPara fechar pedido, confirme seu nome.` }], details: { count, subtotal } };
    },
  });

  const checkout = defineTool({
    name: "checkout",
    label: "Fechar Pedido do Carrinho",
    description: "Converte o carrinho em um pedido. Requer nome e CEP.",
    promptSnippet: "Converte carrinho em pedido (nome + CEP obrigatórios)",
    promptGuidelines: [
      "Use quando o cliente confirmar que quer fechar com os itens do carrinho.",
      "Após checkout, instrua o cliente a enviar /confirma.",
    ],
    parameters: Type.Object({
      customer_name: Type.String({ description: "Nome completo do cliente" }),
      cep:   Type.Optional(Type.String({ description: "CEP para entrega" })),
      notes: Type.Optional(Type.String({ description: "Observações do cliente" })),
    }),
    async execute(_toolCallId, params) {
      const blocked = await pendingOrderBlock(phone, repos);
      if (blocked) return blocked;
      const { items, subtotal, count } = await repos.cart.getSummary(phone);
      if (count === 0) return { content: [{ type: "text", text: "Carrinho vazio — nada para fechar." }], details: { error: true } };

      for (const item of items) {
        const product = await repos.products.getBySku(item.product_sku);
        if (!product || !product.available) {
          return { content: [{ type: "text", text: `Erro: "${item.product_name || item.product_sku}" não está mais disponível.` }], details: { error: true } };
        }
        if (Math.abs(Number(product.price) - Number(item.unit_price)) > 0.01) {
          await repos.cart.addItem(phone, item.product_sku, item.qty, Number(product.price));
        }
      }

      const updated = await repos.cart.getSummary(phone);
      const total = updated.subtotal;
      const customer = await repos.customers.getByPhone(phone);
      const infoUpdate = { name: params.customer_name };
      if (params.cep) infoUpdate.cep = params.cep;
      await repos.customers.updateInfo(phone, infoUpdate);

      const orderItems = updated.items.map(i => ({
        sku: i.product_sku, name: i.product_name || i.product_sku,
        qty: i.qty, unit_price: Number(i.unit_price),
      }));

      const orderId = await repos.orders.create(phone, {
        customerId: customer?.id ?? null, name: params.customer_name,
        items: orderItems, subtotal: total, discount: 0, shipping: null, total,
        cep: params.cep || null, notes: params.notes || null,
      });

      await repos.cart.clear(phone);

      const lines = orderItems.map(i => `${i.qty}x ${i.name} — R$ ${(i.qty * i.unit_price).toFixed(2)}`);
      const summary = [`Pedido #${ORDER_PREFIX}${orderId} criado a partir do carrinho.`, "", ...lines, `Total: R$ ${total.toFixed(2)}`, "", "Instrua o cliente a enviar /confirma para confirmar ou /cancelar para desistir."].join("\n");
      return { content: [{ type: "text", text: summary }], details: { orderId, phone, items: orderItems, total } };
    },
  });

  return [addToCart, updateCart, removeFromCart, viewCart, checkout];
}
