/**
 * @fileoverview Order tools for the Pi Agent.
 *
 * Validates against the products table (SQLite) and links orders to customer_id.
 * Order-id display prefix comes from the ORDER_PREFIX env var.
 */

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const ORDER_PREFIX = process.env.ORDER_PREFIX || "";

/**
 * Creates order tools bound to a specific phone and repos.
 *
 * @param {string} phone - Customer phone number.
 * @param {{ orders: ReturnType<typeof import('../db/orders.mjs').createOrderRepo>, products: ReturnType<typeof import('../db/products.mjs').createProductRepo>, customers: ReturnType<typeof import('../db/customers.mjs').createCustomerRepo> }} repos
 * @returns {Array} Array with create_order and list_orders tools.
 */
export function createOrderTools(phone, repos) {
  const createOrderTool = defineTool({
    name: "create_order",
    label: "Registrar Pedido",
    description:
      "Registra um pedido para o cliente atual. Use após confirmar itens, " +
      "quantidades, nome e CEP com o cliente. Retorna o resumo do pedido.",
    promptSnippet: "Registra pedido do cliente atual (itens, nome, CEP)",
    promptGuidelines: [
      "Use create_order somente após confirmar todos os itens, quantidades, nome e CEP com o cliente.",
      "Sempre use search_catalog antes de chamar create_order para garantir SKUs e preços corretos.",
      "Após create_order retornar sucesso, apresente o resumo ao cliente e instrua a enviar /confirma.",
    ],
    parameters: Type.Object({
      customer_name: Type.String({ description: "Nome do cliente" }),
      cep: Type.Optional(Type.String({ description: "CEP para entrega" })),
      items: Type.Array(
        Type.Object({
          sku: Type.String({ description: "SKU do catálogo" }),
          name: Type.String({ description: "Nome do produto para exibição" }),
          qty: Type.Number({ description: "Quantidade" }),
          unit_price: Type.Number({ description: "Preço unitário conforme catálogo" }),
        })
      ),
      notes: Type.Optional(Type.String({ description: "Observações do cliente" })),
    }),

    async execute(_toolCallId, params) {
      // Validate each item against products table
      for (const item of params.items) {
        const product = repos.products.getBySku(item.sku);
        if (!product) {
          return {
            content: [{ type: "text", text: `Erro: SKU "${item.sku}" não encontrado no catálogo. Use search_catalog para verificar.` }],
            details: { error: true },
          };
        }
        if (!product.available) {
          return {
            content: [{ type: "text", text: `Erro: "${item.name}" não está disponível no momento.` }],
            details: { error: true },
          };
        }
        if (Math.abs(product.price - item.unit_price) > 0.01) {
          return {
            content: [{ type: "text", text: `Erro: preço de "${item.name}" é R$ ${product.price.toFixed(2)}, não R$ ${item.unit_price.toFixed(2)}. Use search_catalog para verificar.` }],
            details: { error: true },
          };
        }
      }

      const subtotal = params.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
      const total = subtotal;

      // Get customer_id for FK
      const customer = repos.customers.getByPhone(phone);
      const customerId = customer?.id ?? null;

      // Also save name and CEP to customer record
      const infoUpdate = { name: params.customer_name };
      if (params.cep) infoUpdate.cep = params.cep;
      repos.customers.updateInfo(phone, infoUpdate);

      const orderId = repos.orders.create(phone, {
        customerId,
        name: params.customer_name,
        items: params.items,
        subtotal,
        discount: 0,
        shipping: null,
        total,
        cep: params.cep || null,
        notes: params.notes || null,
      });

      const lines = params.items.map(i =>
        `${i.qty}x ${i.name} — R$ ${(i.qty * i.unit_price).toFixed(2)}`
      );

      const summary = [
        `Pedido #${ORDER_PREFIX}${orderId} registrado.`,
        '',
        ...lines,
        `Subtotal: R$ ${subtotal.toFixed(2)}`,
        '',
        'Instrua o cliente a enviar /confirma para confirmar ou /cancelar para desistir.',
      ].join('\n');

      return {
        content: [{ type: "text", text: summary }],
        details: { orderId, phone, items: params.items, total },
      };
    },
  });

  const listOrdersTool = defineTool({
    name: "list_orders",
    label: "Consultar Pedidos",
    description:
      "Consulta pedidos anteriores do cliente atual. Use para histórico, " +
      "recompras ou verificar se é cliente novo.",
    promptSnippet: "Consulta histórico de pedidos do cliente atual",
    promptGuidelines: [
      "Use list_orders quando o cliente perguntar sobre pedidos anteriores ou quiser repetir uma compra.",
      "Para clientes que retornam, mencione o que compraram antes e ofereça recompra.",
    ],
    parameters: Type.Object({
      status: Type.Optional(
        Type.String({ description: "Filtrar: pending, confirmed, paid, shipped, delivered, cancelled" })
      ),
      limit: Type.Optional(
        Type.Number({ description: "Máximo de resultados (padrão: 10)" })
      ),
    }),

    async execute(_toolCallId, params) {
      const orders = repos.orders.listByPhone(phone, {
        status: params.status,
        limit: params.limit || 10,
      });

      if (orders.length === 0) {
        return {
          content: [{ type: "text", text: "O cliente não possui pedidos anteriores." }],
          details: { count: 0 },
        };
      }

      const statusMap = {
        pending: "pendente",
        confirmed: "confirmado",
        paid: "pago",
        shipped: "enviado",
        delivered: "entregue",
        cancelled: "cancelado",
      };

      const lines = orders.map(o => {
        const items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
        const desc = items.map(i => `${i.qty}x ${i.name}`).join(', ');
        const date = o.created_at.slice(0, 10).split('-').reverse().join('/');
        return `#${ORDER_PREFIX}${o.id} | ${date} | ${statusMap[o.status] || o.status} | ${desc} | R$ ${o.total.toFixed(2)}`;
      });

      const totalSpent = orders
        .filter(o => !['cancelled', 'pending'].includes(o.status))
        .reduce((s, o) => s + o.total, 0);

      const summary = [
        'Pedidos do cliente:',
        '',
        ...lines,
        '',
        `Total: ${orders.length} pedido(s) | R$ ${totalSpent.toFixed(2)} gastos`,
      ].join('\n');

      return {
        content: [{ type: "text", text: summary }],
        details: { count: orders.length, totalSpent },
      };
    },
  });

  return [createOrderTool, listOrdersTool];
}
