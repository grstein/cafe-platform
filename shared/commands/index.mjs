/**
 * @fileoverview Static command registry.
 *
 * Handles slash commands (and their natural-language aliases) that bypass
 * the LLM agent. Each command is a pure function that reads/writes the DB
 * and returns a response string.
 */

import { generatePixCode } from "../lib/pix.mjs";
import { handleCarrinho } from "./carrinho.mjs";

/**
 * @typedef {{ command: string, text: string|null, resetSession?: boolean }} CommandResult
 */

/**
 * Alias map — normalizes user input to canonical command names.
 * Copied verbatim from the original consumer + new commands.
 */
const aliases = {
  "reiniciar": "/reiniciar",
  "/reiniciar": "/reiniciar",
  "ajuda": "/ajuda",
  "/ajuda": "/ajuda",
  "confirma": "/confirma",
  "confirmar": "/confirma",
  "/confirma": "/confirma",
  "/confirmar": "/confirma",
  "cancelar": "/cancelar",
  "cancela": "/cancelar",
  "/cancelar": "/cancelar",
  "/cancela": "/cancelar",
  "pedido": "/pedido",
  "/pedido": "/pedido",
  "carrinho": "/carrinho",
  "/carrinho": "/carrinho",
  "indicar": "/indicar",
  "/indicar": "/indicar",
  "meucodigo": "/indicar",
  "/meucodigo": "/indicar",
  "modelo": "/modelo",
  "/modelo": "/modelo",
  "/modelo 1": "/modelo 1",
  "/modelo 2": "/modelo 2",
  "/modelo 3": "/modelo 3",
  "/modelo 4": "/modelo 4",
  "modelo 1": "/modelo 1",
  "modelo 2": "/modelo 2",
  "modelo 3": "/modelo 3",
  "modelo 4": "/modelo 4",
};

/**
 * Format order items for display.
 *
 * @param {Object} order - Order row from the database.
 * @returns {string}
 */
function formatItems(order) {
  const items = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
  return items.map(i => `${i.qty}x ${i.name} — R$ ${(i.qty * i.unit_price).toFixed(2)}`).join("\n");
}

/**
 * Creates the command handler registry.
 *
 * @param {{ orders: any, cart?: any, customers?: any, referrals?: any }} repos
 * @param {{ key: string, name: string, city: string } | null} pixConfig
 * @param {{ botPhone?: string, availableModels?: Array<{ id: string, name: string, emoji: string }>, defaultModelId?: string, displayName?: string, orderPrefix?: string }} [extraConfig]
 * @returns {{ tryHandle(text: string, phone: string): CommandResult | null }}
 */
export function createCommandHandlers(repos, pixConfig, extraConfig = {}) {
  const displayName = extraConfig.displayName || "Atendimento";
  const orderPrefix = extraConfig.orderPrefix || "";
  const fmtOrderId = (id) => `${orderPrefix}${id}`;
  /**
   * Try to handle a message as a static command.
   *
   * @param {string} text - Raw message text.
   * @param {string} phone - Sender phone number.
   * @returns {CommandResult | null} Result if matched, null otherwise.
   */
  function tryHandle(text, phone) {
    const cmd = text.trim().toLowerCase();

    // Check /modelo with optional argument first (before alias lookup)
    const modeloMatch = cmd.match(/^\/?modelo(?:\s+(\d+))?$/);
    if (modeloMatch) {
      const choice = modeloMatch[1] ? parseInt(modeloMatch[1], 10) : null;
      return handleModelo(phone, choice);
    }

    const resolved = aliases[cmd];
    if (!resolved) return null;

    switch (resolved) {
      case "/reiniciar":
        return handleReiniciar();
      case "/ajuda":
        return handleAjuda(phone);
      case "/confirma":
        return handleConfirma(phone);
      case "/cancelar":
        return handleCancelar(phone);
      case "/pedido":
        return handlePedido(phone);
      case "/carrinho":
        return handleCarrinho(phone, repos);
      case "/indicar":
        return handleIndicar(phone);
      default:
        return null;
    }
  }

  // ── Individual handlers ─────────────────────────────────────────────

  function handleReiniciar() {
    return { command: "reiniciar", text: "Conversa reiniciada! Como posso te ajudar?", resetSession: true };
  }

  function handleAjuda(phone) {
    // Resolve current model name for this user
    const models = extraConfig.availableModels || [];
    const defaultId = extraConfig.defaultModelId || '';
    let currentModelName = defaultId;
    if (repos.customers) {
      const cust = repos.customers.getByPhone(phone);
      if (cust?.preferences) {
        try {
          const prefs = JSON.parse(cust.preferences);
          if (prefs.modelo) {
            const m = models.find(m => m.id === prefs.modelo);
            currentModelName = m ? `${m.emoji} ${m.name}` : prefs.modelo;
          } else {
            const m = models.find(m => m.id === defaultId);
            currentModelName = m ? `${m.emoji} ${m.name}` : defaultId;
          }
        } catch { /* ignore */ }
      } else {
        const m = models.find(m => m.id === defaultId);
        currentModelName = m ? `${m.emoji} ${m.name}` : defaultId;
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
      "",
    ].join("\n");
    return { command: "ajuda", text };
  }

  function handleConfirma(phone) {
    if (!pixConfig || !pixConfig.key) {
      return { command: "confirma", text: "Erro interno: chave PIX não configurada. Entre em contato conosco." };
    }
    const order = repos.orders.confirm(phone);
    if (!order) {
      return { command: "confirma", text: "Nenhum pedido pendente. Quer que eu monte um pra você? É só conversar comigo! ☕" };
    }

    // Activate referral reward if this is first purchase of a referred customer
    if (repos.referrals && repos.customers) {
      const customer = repos.customers.getByPhone(phone);
      if (customer?.referred_by_phone && customer.total_orders === 0) {
        repos.referrals.activate(phone);
      }
      // Update customer to 'active' if still 'invited'
      if (customer?.access_status === 'invited') {
        repos.customers.setAccessStatus(phone, 'active');
      }
      // Update counters
      repos.customers.updateCounters(phone);
    }
    const brcode = generatePixCode({
      key: pixConfig.key,
      name: pixConfig.name,
      city: pixConfig.city,
      orderId: order.id,
      amount: order.total,
    });
    const instructions = [
      `✅ Pedido #${fmtOrderId(order.id)} confirmado!`,
      "",
      formatItems(order),
      `Total: R$ ${order.total.toFixed(2)}`,
      "",
      "PIX copia e cola — copie a próxima mensagem e cole no app do banco.",
      "O valor e identificação do pedido já estão preenchidos.",
      "",
      "Após pagar, envie o comprovante aqui.",
    ].join("\n");
    // Retorna 2 mensagens: instruções + código PIX sozinho (facilita copia e cola)
    return { command: "confirma", text: instructions, messages: [instructions, brcode] };
  }

  function handleCancelar(phone) {
    const order = repos.orders.cancel(phone);
    if (!order) {
      return { command: "cancelar", text: "Nenhum pedido pendente para cancelar." };
    }
    return { command: "cancelar", text: `Pedido #${fmtOrderId(order.id)} cancelado. Sem problemas! Quando quiser, é só me chamar. ☕` };
  }

  function handlePedido(phone) {
    const order = repos.orders.getPending(phone);
    if (!order) {
      return { command: "pedido", text: "Nenhum pedido pendente no momento. Quer que eu te ajude a montar um? ☕" };
    }
    const text = [
      `📋 Pedido pendente #${fmtOrderId(order.id)}:`,
      "",
      formatItems(order),
      `Total: R$ ${order.total.toFixed(2)}`,
      "",
      "Envie /confirma para confirmar ou /cancelar para desistir.",
    ].join("\n");
    return { command: "pedido", text };
  }

  function handleIndicar(phone) {
    if (!repos.customers) {
      return { command: "indicar", text: "Recurso indisponível no momento." };
    }

    const code = repos.customers.ensureReferralCode(phone);
    const botNum = extraConfig.botPhone || '';
    const link = botNum
      ? `https://wa.me/${botNum}?text=${encodeURIComponent(code)}`
      : null;

    const lines = [
      `☕ Seu código de indicação: ${code}`,
      '',
    ];

    if (link) {
      lines.push(`Compartilha esse link:`);
      lines.push(link);
      lines.push('');
    }

    lines.push('Ou me diz o número de quem quer indicar que eu libero o acesso!');
    lines.push('');
    lines.push('Quando seu indicado fizer a primeira compra, você ganha 10% de desconto no próximo pedido 🎉');

    return { command: "indicar", text: lines.join('\n') };
  }

  function handleModelo(phone, choice) {
    const models = extraConfig.availableModels || [];
    if (models.length === 0) {
      return { command: "modelo", text: "Nenhum modelo disponível para seleção." };
    }

    const defaultId = extraConfig.defaultModelId || models[0]?.id;

    // Resolve current model
    let currentId = defaultId;
    if (repos.customers) {
      const cust = repos.customers.getByPhone(phone);
      if (cust?.preferences) {
        try {
          const prefs = JSON.parse(cust.preferences);
          if (prefs.modelo) currentId = prefs.modelo;
        } catch { /* ignore */ }
      }
    }

    // No choice → show menu
    if (choice === null || choice === undefined) {
      const lines = [
        '🤖 Modelos disponíveis:',
        '',
      ];
      models.forEach((m, i) => {
        const isCurrent = m.id === currentId;
        lines.push(`${i + 1}. ${m.emoji} ${m.name}${isCurrent ? ' (atual)' : ''}`);
      });
      lines.push('');
      lines.push('Envie /modelo N para trocar (ex: /modelo 2)');
      return { command: "modelo", text: lines.join('\n') };
    }

    // Choice → select model
    const idx = choice - 1;
    if (idx < 0 || idx >= models.length) {
      return { command: "modelo", text: `Número inválido. Escolha de 1 a ${models.length}.` };
    }

    const selected = models[idx];
    if (selected.id === currentId) {
      return { command: "modelo", text: `Você já está usando ${selected.emoji} ${selected.name}!` };
    }

    // Save preference
    if (repos.customers) {
      const cust = repos.customers.getByPhone(phone);
      let prefs = {};
      if (cust?.preferences) {
        try { prefs = JSON.parse(cust.preferences); } catch { /* start fresh */ }
      }
      prefs.modelo = selected.id;
      repos.customers.updateInfo(phone, { preferences: JSON.stringify(prefs) });
    }

    // Signal session reset so the new model takes effect
    return {
      command: "modelo",
      text: `Modelo alterado para ${selected.emoji} ${selected.name}! Reiniciando conversa...`,
      resetSession: true,
    };
  }

  return { tryHandle };
}
