/**
 * @fileoverview Cart tools for the Pi Agent.
 *
 * Allows the agent to build orders incrementally: add items one by one,
 * update quantities, remove items, view the cart, and checkout
 * (converting the cart into an order).
 */

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const ORDER_PREFIX = process.env.ORDER_PREFIX || "";

/**
 * Creates cart tools bound to a specific phone and repos.
 *
 * @param {string} phone
 * @param {{ cart: ReturnType<typeof import('../db/cart.mjs').createCartRepo>, products: ReturnType<typeof import('../db/products.mjs').createProductRepo>, orders: ReturnType<typeof import('../db/orders.mjs').createOrderRepo>, customers: ReturnType<typeof import('../db/customers.mjs').createCustomerRepo> }} repos
 * @returns {Array} Array of cart tool definitions.
 */
export function createCartTools(phone, repos) {
  // ── add_to_cart ─────────────────────────────────────────────────────

  const addToCart = defineTool({
    name: "add_to_cart",
    label: "Adicionar ao Carrinho",
    description:
      "Adiciona um café ao carrinho do cliente. Se o item já estiver " +
      "no carrinho, atualiza a quantidade. Valida contra o catálogo.",
    promptSnippet: "Adiciona item ao carrinho (SKU + quantidade)",
    promptGuidelines: [
      "Use add_to_cart quando o cliente quiser adicionar um café ao pedido.",
      "Sempre use search_catalog antes para confirmar SKU e preço.",
      "Após adicionar, informe o que está no carrinho e o subtotal.",
    ],
    parameters: Type.Object({
      sku: Type.String({ description: "SKU do produto" }),
      qty: Type.Optional(Type.Number({ description: "Quantidade (padrão: 1)" })),
    }),

    async execute(_toolCallId, params) {
      const qty = params.qty || 1;
      const product = repos.products.getBySku(params.sku);

      if (!product) {
        return {
          content: [{ type: "text", text: `Erro: SKU "${params.sku}" não encontrado. Use search_catalog.` }],
          details: { error: true },
        };
      }
      if (!product.available) {
        return {
          content: [{ type: "text", text: `Erro: "${product.name}" não está disponível no momento.` }],
          details: { error: true },
        };
      }

      repos.cart.addItem(phone, params.sku, qty, product.price);
      const { items, subtotal, count } = repos.cart.getSummary(phone);

      const desc = items.map(i =>
        `${i.qty}x ${i.product_name || i.product_sku} — R$ ${(i.qty * i.unit_price).toFixed(2)}`
      ).join('\n');

      return {
        content: [{
          type: "text",
          text: `Item adicionado! Carrinho atual:\n\n${desc}\n\nSubtotal: R$ ${subtotal.toFixed(2)}\n${count} item(ns) no carrinho.`,
        }],
        details: { sku: params.sku, qty, subtotal, count },
      };
    },
  });

  // ── update_cart ─────────────────────────────────────────────────────

  const updateCart = defineTool({
    name: "update_cart",
    label: "Atualizar Carrinho",
    description: "Altera a quantidade de um item no carrinho.",
    promptSnippet: "Altera quantidade de um item no carrinho",
    promptGuidelines: [
      "Use update_cart quando o cliente quiser mudar a quantidade de um item já no carrinho.",
    ],
    parameters: Type.Object({
      sku: Type.String({ description: "SKU do produto no carrinho" }),
      qty: Type.Number({ description: "Nova quantidade (0 para remover)" }),
    }),

    async execute(_toolCallId, params) {
      if (params.qty <= 0) {
        repos.cart.removeItem(phone, params.sku);
      } else {
        const updated = repos.cart.updateQty(phone, params.sku, params.qty);
        if (!updated) {
          return {
            content: [{ type: "text", text: `Item "${params.sku}" não está no carrinho.` }],
            details: { error: true },
          };
        }
      }

      const { items, subtotal, count } = repos.cart.getSummary(phone);
      if (count === 0) {
        return {
          content: [{ type: "text", text: "Carrinho vazio." }],
          details: { count: 0 },
        };
      }

      const desc = items.map(i =>
        `${i.qty}x ${i.product_name || i.product_sku} — R$ ${(i.qty * i.unit_price).toFixed(2)}`
      ).join('\n');

      return {
        content: [{ type: "text", text: `Carrinho atualizado:\n\n${desc}\n\nSubtotal: R$ ${subtotal.toFixed(2)}` }],
        details: { count, subtotal },
      };
    },
  });

  // ── remove_from_cart ────────────────────────────────────────────────

  const removeFromCart = defineTool({
    name: "remove_from_cart",
    label: "Remover do Carrinho",
    description: "Remove um item do carrinho.",
    promptSnippet: "Remove item do carrinho por SKU",
    promptGuidelines: [
      "Use remove_from_cart quando o cliente quiser tirar um item específico do carrinho.",
    ],
    parameters: Type.Object({
      sku: Type.String({ description: "SKU do produto a remover" }),
    }),

    async execute(_toolCallId, params) {
      const removed = repos.cart.removeItem(phone, params.sku);
      if (!removed) {
        return {
          content: [{ type: "text", text: `Item "${params.sku}" não estava no carrinho.` }],
          details: { error: true },
        };
      }

      const { items, subtotal, count } = repos.cart.getSummary(phone);
      if (count === 0) {
        return {
          content: [{ type: "text", text: "Item removido. Carrinho vazio agora." }],
          details: { count: 0 },
        };
      }

      const desc = items.map(i =>
        `${i.qty}x ${i.product_name || i.product_sku} — R$ ${(i.qty * i.unit_price).toFixed(2)}`
      ).join('\n');

      return {
        content: [{ type: "text", text: `Item removido. Carrinho:\n\n${desc}\n\nSubtotal: R$ ${subtotal.toFixed(2)}` }],
        details: { count, subtotal },
      };
    },
  });

  // ── view_cart ───────────────────────────────────────────────────────

  const viewCart = defineTool({
    name: "view_cart",
    label: "Ver Carrinho",
    description: "Mostra o conteúdo atual do carrinho do cliente.",
    promptSnippet: "Mostra itens e subtotal do carrinho",
    promptGuidelines: [
      "Use view_cart quando o cliente perguntar o que tem no carrinho.",
    ],
    parameters: Type.Object({}),

    async execute() {
      const { items, subtotal, count } = repos.cart.getSummary(phone);
      if (count === 0) {
        return {
          content: [{ type: "text", text: "Carrinho vazio." }],
          details: { count: 0 },
        };
      }

      const desc = items.map(i =>
        `${i.qty}x ${i.product_name || i.product_sku} — R$ ${(i.qty * i.unit_price).toFixed(2)}`
      ).join('\n');

      return {
        content: [{ type: "text", text: `Carrinho:\n\n${desc}\n\nSubtotal: R$ ${subtotal.toFixed(2)}\n\nPara fechar pedido, confirme seu nome.` }],
        details: { count, subtotal },
      };
    },
  });

  // ── checkout ────────────────────────────────────────────────────────

  const checkout = defineTool({
    name: "checkout",
    label: "Fechar Pedido do Carrinho",
    description:
      "Converte o carrinho em um pedido. Requer nome e CEP do cliente. " +
      "O carrinho é limpo após a criação do pedido.",
    promptSnippet: "Converte carrinho em pedido (nome + CEP obrigatórios)",
    promptGuidelines: [
      "Use checkout quando o cliente confirmar que quer fechar o pedido com os itens do carrinho.",
      "Exige customer_name e cep. Pergunte ao cliente antes de chamar.",
      "Após checkout, instrua o cliente a enviar /confirma.",
    ],
    parameters: Type.Object({
      customer_name: Type.String({ description: "Nome completo do cliente" }),
      cep: Type.Optional(Type.String({ description: "CEP para entrega" })),
      notes: Type.Optional(Type.String({ description: "Observações do cliente" })),
    }),

    async execute(_toolCallId, params) {
      const { items, subtotal, count } = repos.cart.getSummary(phone);

      if (count === 0) {
        return {
          content: [{ type: "text", text: "Carrinho vazio — nada para fechar." }],
          details: { error: true },
        };
      }

      // Re-validate prices against products
      for (const item of items) {
        const product = repos.products.getBySku(item.product_sku);
        if (!product || !product.available) {
          return {
            content: [{
              type: "text",
              text: `Erro: "${item.product_name || item.product_sku}" não está mais disponível. Remova com remove_from_cart e tente novamente.`,
            }],
            details: { error: true },
          };
        }
        if (Math.abs(product.price - item.unit_price) > 0.01) {
          // Price changed since added to cart — update
          repos.cart.addItem(phone, item.product_sku, item.qty, product.price);
        }
      }

      // Recalculate after potential price corrections
      const updated = repos.cart.getSummary(phone);
      const total = updated.subtotal;

      // Get customer_id for FK
      const customer = repos.customers.getByPhone(phone);
      const customerId = customer?.id ?? null;

      // Save customer info
      const infoUpdate = { name: params.customer_name };
      if (params.cep) infoUpdate.cep = params.cep;
      repos.customers.updateInfo(phone, infoUpdate);

      // Convert cart items to order items format
      const orderItems = updated.items.map(i => ({
        sku: i.product_sku,
        name: i.product_name || i.product_sku,
        qty: i.qty,
        unit_price: i.unit_price,
      }));

      const orderId = repos.orders.create(phone, {
        customerId,
        name: params.customer_name,
        items: orderItems,
        subtotal: total,
        discount: 0,
        shipping: null,
        total,
        cep: params.cep || null,
        notes: params.notes || null,
      });

      // Clear cart after successful order creation
      repos.cart.clear(phone);

      const lines = orderItems.map(i =>
        `${i.qty}x ${i.name} — R$ ${(i.qty * i.unit_price).toFixed(2)}`
      );

      const summary = [
        `Pedido #${ORDER_PREFIX}${orderId} criado a partir do carrinho.`,
        '',
        ...lines,
        `Total: R$ ${total.toFixed(2)}`,
        '',
        'Instrua o cliente a enviar /confirma para confirmar ou /cancelar para desistir.',
      ].join('\n');

      return {
        content: [{ type: "text", text: summary }],
        details: { orderId, phone, items: orderItems, total },
      };
    },
  });

  return [addToCart, updateCart, removeFromCart, viewCart, checkout];
}
