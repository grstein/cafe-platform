/**
 * @fileoverview Order tools for the Pi Agent — async repos.
 */

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const ORDER_PREFIX = process.env.ORDER_PREFIX || "";

export function createOrderTools(phone, repos) {
  const createOrderTool = defineTool({
    name: "create_order",
    label: "Registrar Pedido",
    description:
      "Registra um pedido para o cliente atual. Use após confirmar itens, " +
      "quantidades, nome e CEP com o cliente.",
    promptSnippet: "Registra pedido do cliente atual (itens, nome, CEP)",
    promptGuidelines: [
      "Use create_order somente após confirmar todos os itens, quantidades, nome e CEP.",
      "Sempre use search_catalog antes para garantir SKUs e preços corretos.",
      "Após sucesso, apresente o resumo e instrua a enviar /confirma.",
    ],
    parameters: Type.Object({
      customer_name: Type.String({ description: "Nome do cliente" }),
      cep: Type.Optional(Type.String({ description: "CEP para entrega" })),
      items: Type.Array(Type.Object({
        sku:        Type.String({ description: "SKU do catálogo" }),
        name:       Type.String({ description: "Nome do produto para exibição" }),
        qty:        Type.Number({ description: "Quantidade" }),
        unit_price: Type.Number({ description: "Preço unitário conforme catálogo" }),
      })),
      notes: Type.Optional(Type.String({ description: "Observações do cliente" })),
    }),

    async execute(_toolCallId, params) {
      const pending = await repos.orders.getPending(phone);
      if (pending) {
        return {
          content: [{ type: "text", text: `Cliente tem o pedido #${ORDER_PREFIX}${pending.id} aguardando pagamento (R$ ${Number(pending.total).toFixed(2)}). Peça para enviar /confirma para pagar ou /cancelar para desistir antes de montar um novo pedido.` }],
          details: { error: true, pendingOrderId: pending.id },
        };
      }
      for (const item of params.items) {
        const product = await repos.products.getBySku(item.sku);
        if (!product) {
          return { content: [{ type: "text", text: `Erro: SKU "${item.sku}" não encontrado. Use search_catalog.` }], details: { error: true } };
        }
        if (!product.available) {
          return { content: [{ type: "text", text: `Erro: "${item.name}" não está disponível.` }], details: { error: true } };
        }
        if (Math.abs(Number(product.price) - item.unit_price) > 0.01) {
          return { content: [{ type: "text", text: `Erro: preço de "${item.name}" é R$ ${Number(product.price).toFixed(2)}, não R$ ${item.unit_price.toFixed(2)}.` }], details: { error: true } };
        }
      }

      const subtotal = params.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
      const customer = await repos.customers.getByPhone(phone);
      const customerId = customer?.id ?? null;
      const infoUpdate = { name: params.customer_name };
      if (params.cep) infoUpdate.cep = params.cep;
      await repos.customers.updateInfo(phone, infoUpdate);

      const orderId = await repos.orders.create(phone, {
        customerId, name: params.customer_name, items: params.items,
        subtotal, discount: 0, shipping: null, total: subtotal,
        cep: params.cep || null, notes: params.notes || null,
      });

      const lines = params.items.map(i => `${i.qty}x ${i.name} — R$ ${(i.qty * i.unit_price).toFixed(2)}`);
      const summary = [
        `Pedido #${ORDER_PREFIX}${orderId} registrado.`, "",
        ...lines, `Subtotal: R$ ${subtotal.toFixed(2)}`, "",
        "Instrua o cliente a enviar /confirma para confirmar ou /cancelar para desistir.",
      ].join("\n");

      return { content: [{ type: "text", text: summary }], details: { orderId, phone, items: params.items, total: subtotal } };
    },
  });

  const listOrdersTool = defineTool({
    name: "list_orders",
    label: "Consultar Pedidos",
    description: "Consulta pedidos anteriores do cliente atual.",
    promptSnippet: "Consulta histórico de pedidos do cliente atual",
    promptGuidelines: [
      "Use list_orders quando o cliente perguntar sobre pedidos anteriores ou quiser repetir uma compra.",
    ],
    parameters: Type.Object({
      status: Type.Optional(Type.String({ description: "Filtrar: pending, confirmed, paid, shipped, delivered, cancelled" })),
      limit:  Type.Optional(Type.Number({ description: "Máximo de resultados (padrão: 10)" })),
    }),

    async execute(_toolCallId, params) {
      const orders = await repos.orders.listByPhone(phone, { status: params.status, limit: params.limit || 10 });
      if (orders.length === 0) {
        return { content: [{ type: "text", text: "O cliente não possui pedidos anteriores." }], details: { count: 0 } };
      }

      const statusMap = { pending: "pendente", confirmed: "confirmado", paid: "pago", shipped: "enviado", delivered: "entregue", cancelled: "cancelado" };
      const lines = orders.map(o => {
        const items = typeof o.items === "string" ? JSON.parse(o.items) : o.items;
        const desc = items.map(i => `${i.qty}x ${i.name}`).join(", ");
        const date = String(o.created_at).slice(0, 10).split("-").reverse().join("/");
        return `#${ORDER_PREFIX}${o.id} | ${date} | ${statusMap[o.status] || o.status} | ${desc} | R$ ${Number(o.total).toFixed(2)}`;
      });

      const totalSpent = orders
        .filter(o => !["cancelled", "pending"].includes(o.status))
        .reduce((s, o) => s + Number(o.total), 0);

      const summary = ["Pedidos do cliente:", "", ...lines, "", `Total: ${orders.length} pedido(s) | R$ ${totalSpent.toFixed(2)} gastos`].join("\n");
      return { content: [{ type: "text", text: summary }], details: { count: orders.length, totalSpent } };
    },
  });

  return [createOrderTool, listOrdersTool];
}
