/**
 * @fileoverview Referral tools for the Pi Agent.
 *
 * Allows the agent to invite new customers and check referral info.
 */

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

/**
 * Creates referral tools bound to a specific phone and repos.
 *
 * @param {string} phone - Current customer's phone.
 * @param {{ customers: any, referrals: any }} repos
 * @param {string} botPhone - Bot's WhatsApp number (for wa.me link).
 * @param {string} [displayName] - Tenant display name used in tool descriptions.
 * @returns {Array} Array of referral tool definitions.
 */
export function createReferralTools(phone, repos, botPhone, displayName = "") {
  const businessLabel = displayName || "o serviço";
  const inviteCustomer = defineTool({
    name: "invite_customer",
    label: "Convidar Cliente",
    description:
      `Pré-autoriza um número de WhatsApp para usar ${businessLabel}. ` +
      "Use quando o cliente quiser indicar alguém e fornecer o número.",
    promptSnippet: "Convida um novo cliente por número de WhatsApp",
    promptGuidelines: [
      "Use invite_customer quando o cliente fornecer o número de alguém para indicar.",
      "Normalize o número: remova espaços, parênteses, hífens. Inclua DDI 55 + DDD.",
      "Após convidar, informe que o convidado já pode mandar mensagem pro bot.",
    ],
    parameters: Type.Object({
      invited_phone: Type.String({ description: "Número do convidado (ex: 5541999998888)" }),
      invited_name: Type.Optional(Type.String({ description: "Nome do convidado, se informado" })),
    }),

    async execute(_toolCallId, params) {
      const invitedPhone = params.invited_phone.replace(/\D/g, '');

      // Check if already a customer
      const existing = repos.customers.getByPhone(invitedPhone);
      if (existing && existing.access_status !== 'blocked') {
        return {
          content: [{ type: "text", text: `Esse número já tem acesso a ${businessLabel}!` }],
          details: { alreadyExists: true },
        };
      }

      // Get referrer's code
      const referrerCode = repos.customers.ensureReferralCode(phone);

      // Create invited customer
      repos.customers.upsert(invitedPhone, { push_name: params.invited_name || null });
      repos.customers.updateInfo(invitedPhone, { referred_by_phone: phone });
      if (params.invited_name) {
        repos.customers.updateInfo(invitedPhone, { name: params.invited_name });
      }
      repos.customers.setAccessStatus(invitedPhone, 'invited');
      repos.customers.ensureReferralCode(invitedPhone);
      repos.referrals.create(phone, invitedPhone, referrerCode);

      const referrer = repos.customers.getByPhone(phone);
      const referrerName = referrer?.name || referrer?.push_name || 'você';

      return {
        content: [{
          type: "text",
          text: `Número ${invitedPhone} liberado! Quando essa pessoa mandar mensagem aqui, vai ser atendida. Quando fizer a primeira compra, ${referrerName} ganha 10% de desconto no próximo pedido.`,
        }],
        details: { invitedPhone, referrerCode },
      };
    },
  });

  const getReferralInfo = defineTool({
    name: "get_referral_info",
    label: "Info de Indicação",
    description:
      "Retorna o código de indicação do cliente, link compartilhável e " +
      "estatísticas de indicações. Use quando o cliente perguntar sobre " +
      "indicação ou quiser seu código.",
    promptSnippet: "Retorna código de indicação, link e stats",
    promptGuidelines: [
      "Use get_referral_info quando o cliente perguntar sobre indicação, código, ou quiser convidar alguém.",
      "Apresente o link de forma simples e direta.",
    ],
    parameters: Type.Object({}),

    async execute() {
      const code = repos.customers.ensureReferralCode(phone);
      const counts = repos.referrals.countByReferrer(phone);
      const pendingRewards = repos.referrals.getPendingRewards(phone);

      const link = botPhone
        ? `https://wa.me/${botPhone}?text=${encodeURIComponent(code)}`
        : null;

      const parts = [
        `Código de indicação: ${code}`,
      ];

      if (link) {
        parts.push(`Link: ${link}`);
      }

      parts.push(`Indicações: ${counts?.total || 0} (${counts?.active || 0} ativos)`);

      if (pendingRewards.length > 0) {
        for (const r of pendingRewards) {
          const name = r.referred_name || r.referred_push_name || r.referred_phone;
          parts.push(`Recompensa pendente: ${name} comprou → ${r.reward_value}% desconto`);
        }
      }

      return {
        content: [{ type: "text", text: parts.join('\n') }],
        details: { code, link, counts },
      };
    },
  });

  return [inviteCustomer, getReferralInfo];
}
