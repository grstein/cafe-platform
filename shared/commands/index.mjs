/**
 * @fileoverview Static command registry — all handlers are async.
 */

import { generatePixCode } from "../lib/pix.mjs";
import { handleCarrinho } from "./carrinho.mjs";

/** Alias map — normalizes user input to canonical command names. */
const aliases = {
  "reiniciar": "/reiniciar", "/reiniciar": "/reiniciar",
  "ajuda": "/ajuda", "/ajuda": "/ajuda",
  "confirma": "/confirma", "confirmar": "/confirma", "/confirma": "/confirma", "/confirmar": "/confirma",
  "cancelar": "/cancelar", "cancela": "/cancelar", "/cancelar": "/cancelar", "/cancela": "/cancelar",
  "pedido": "/pedido", "/pedido": "/pedido",
  "carrinho": "/carrinho", "/carrinho": "/carrinho",
  "indicar": "/indicar", "/indicar": "/indicar", "meucodigo": "/indicar", "/meucodigo": "/indicar",
  "modelo": "/modelo", "/modelo": "/modelo",
};

function formatItems(order) {
  const items = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
  return items.map(i => `${i.qty}x ${i.name} — R$ ${(i.qty * Number(i.unit_price)).toFixed(2)}`).join("\n");
}

/**
 * @param {{ orders: any, cart?: any, customers?: any, referrals?: any }} repos
 * @param {{ key: string, name: string, city: string } | null} pixConfig
 * @param {{ botPhone?, availableModels?, defaultModelId?, displayName?, orderPrefix? }} [extraConfig]
 * @returns {{ tryHandle(text: string, phone: string): Promise<CommandResult | null> }}
 */
export function createCommandHandlers(repos, pixConfig, extraConfig = {}) {
  const displayName = extraConfig.displayName || "Atendimento";
  const orderPrefix = extraConfig.orderPrefix || "";
  const fmtOrderId = (id) => `${orderPrefix}${id}`;

  async function tryHandle(text, phone) {
    const cmd = text.trim().toLowerCase();

    // /modelo with optional numeric arg
    const modeloMatch = cmd.match(/^\/?modelo(?:\s+(\d+))?$/);
    if (modeloMatch) {
      const choice = modeloMatch[1] ? parseInt(modeloMatch[1], 10) : null;
      return handleModelo(phone, choice);
    }

    const resolved = aliases[cmd];
    if (!resolved) return null;

    switch (resolved) {
      case "/reiniciar": return handleReiniciar();
      case "/ajuda":     return handleAjuda(phone);
      case "/confirma":  return handleConfirma(phone);
      case "/cancelar":  return handleCancelar(phone);
      case "/pedido":    return handlePedido(phone);
      case "/carrinho":  return handleCarrinho(phone, repos);
      case "/indicar":   return handleIndicar(phone);
      default:           return null;
    }
  }

  // ── Handlers ────────────────────────────────────────────────────────

  function handleReiniciar() {
    return { command: "reiniciar", text: "Conversa reiniciada! Como posso te ajudar?", resetSession: true };
  }

  async function handleAjuda(phone) {
    const models = extraConfig.availableModels || [];
    const defaultId = extraConfig.defaultModelId || "";
    let currentModelName = defaultId;

    if (repos.customers) {
      const cust = await repos.customers.getByPhone(phone);
      if (cust?.preferences) {
        try {
          const prefs = JSON.parse(cust.preferences);
          const modelId = prefs.modelo || defaultId;
          const m = models.find(m => m.id === modelId);
          currentModelName = m ? `${m.emoji || ""} ${m.name}`.trim() : modelId;
        } catch {}
      } else {
        const m = models.find(m => m.id === defaultId);
        currentModelName = m ? `${m.emoji || ""} ${m.name}`.trim() : defaultId;
      }
    }

    const text = [
      `☕ ${displayName} — Comandos`,
      "",
      "/ajuda — Esta mensagem",
      "/modelo — Trocar modelo de IA",
      "/indicar — Seu código de indicação",
      "/carrinho — Ver seu carrinho",
      "/pedido — Ver pedido pendente",
      "/confirma — Confirmar pedido e receber PIX",
      "/cancelar — Cancelar pedido pendente",
      "/reiniciar — Recomeçar a conversa",
      "",
      `Modelo atual: ${currentModelName}`,
      "",
      "Como pedir:",
      "1. Me conta o que procura em café",
      "2. Te ajudo a escolher",
      "3. Monto o pedido pra você",
      "4. Confirme com /confirma e pague via PIX",
    ].join("\n");
    return { command: "ajuda", text };
  }

  async function handleConfirma(phone) {
    if (!pixConfig?.key) {
      return { command: "confirma", text: "Erro interno: chave PIX não configurada." };
    }
    const order = await repos.orders.confirm(phone);
    if (!order) {
      return { command: "confirma", text: "Nenhum pedido pendente. Quer que eu monte um pra você? ☕" };
    }

    // Referral activation on first purchase
    if (repos.referrals && repos.customers) {
      const customer = await repos.customers.getByPhone(phone);
      if (customer?.referred_by_phone && Number(customer.total_orders) === 0) {
        await repos.referrals.activate(phone);
      }
      if (customer?.access_status === "invited") {
        await repos.customers.setAccessStatus(phone, "active");
      }
      await repos.customers.updateCounters(phone);
    }

    const brcode = generatePixCode({
      key: pixConfig.key,
      name: pixConfig.name,
      city: pixConfig.city,
      orderId: order.id,
      amount: Number(order.total),
    });

    const instructions = [
      `✅ Pedido #${fmtOrderId(order.id)} confirmado!`,
      "",
      formatItems(order),
      `Total: R$ ${Number(order.total).toFixed(2)}`,
      "",
      "PIX copia e cola — copie a próxima mensagem e cole no app do banco.",
      "O valor e identificação do pedido já estão preenchidos.",
      "",
      "Após pagar, envie o comprovante aqui.",
    ].join("\n");

    return { command: "confirma", text: instructions, messages: [instructions, brcode] };
  }

  async function handleCancelar(phone) {
    const order = await repos.orders.cancel(phone);
    if (!order) {
      return { command: "cancelar", text: "Nenhum pedido pendente para cancelar." };
    }
    return { command: "cancelar", text: `Pedido #${fmtOrderId(order.id)} cancelado. Quando quiser, é só me chamar. ☕` };
  }

  async function handlePedido(phone) {
    const order = await repos.orders.getPending(phone);
    if (!order) {
      return { command: "pedido", text: "Nenhum pedido pendente no momento. Quer que eu te ajude a montar um? ☕" };
    }
    const text = [
      `📋 Pedido pendente #${fmtOrderId(order.id)}:`,
      "",
      formatItems(order),
      `Total: R$ ${Number(order.total).toFixed(2)}`,
      "",
      "Envie /confirma para confirmar ou /cancelar para desistir.",
    ].join("\n");
    return { command: "pedido", text };
  }

  async function handleIndicar(phone) {
    if (!repos.customers) return { command: "indicar", text: "Recurso indisponível." };
    const code = await repos.customers.ensureReferralCode(phone);
    const botNum = extraConfig.botPhone || "";
    const link = botNum
      ? `https://wa.me/${botNum}?text=${encodeURIComponent(code)}`
      : null;

    const lines = [`☕ Seu código de indicação: ${code}`, ""];
    if (link) { lines.push("Compartilha esse link:"); lines.push(link); lines.push(""); }
    lines.push("Compartilha com quem você quer trazer pro clube do café ☕");
    return { command: "indicar", text: lines.join("\n") };
  }

  async function handleModelo(phone, choice) {
    const models = extraConfig.availableModels || [];
    if (models.length === 0) return { command: "modelo", text: "Nenhum modelo disponível." };

    const defaultId = extraConfig.defaultModelId || models[0]?.id;
    let currentId = defaultId;

    if (repos.customers) {
      const cust = await repos.customers.getByPhone(phone);
      if (cust?.preferences) {
        try {
          const prefs = JSON.parse(cust.preferences);
          if (prefs.modelo) currentId = prefs.modelo;
        } catch {}
      }
    }

    if (choice === null || choice === undefined) {
      const lines = ["🤖 Modelos disponíveis:", ""];
      models.forEach((m, i) => {
        const isCurrent = m.id === currentId;
        lines.push(`${i + 1}. ${m.emoji || ""} ${m.name}${isCurrent ? " (atual)" : ""}`.trim());
      });
      lines.push("", "Envie /modelo N para trocar (ex: /modelo 2)");
      return { command: "modelo", text: lines.join("\n") };
    }

    const idx = choice - 1;
    if (idx < 0 || idx >= models.length) {
      return { command: "modelo", text: `Número inválido. Escolha de 1 a ${models.length}.` };
    }
    const selected = models[idx];
    if (selected.id === currentId) {
      return { command: "modelo", text: `Você já está usando ${selected.name}!` };
    }

    if (repos.customers) {
      const cust = await repos.customers.getByPhone(phone);
      let prefs = {};
      try { prefs = JSON.parse(cust?.preferences || "{}"); } catch {}
      prefs.modelo = selected.id;
      await repos.customers.updateInfo(phone, { preferences: JSON.stringify(prefs) });
    }

    return {
      command: "modelo",
      text: `Modelo alterado para ${selected.name}! Reiniciando conversa...`,
      resetSession: true,
    };
  }

  return { tryHandle };
}
