/**
 * @fileoverview Referral tools for the Pi Agent — async repos.
 */

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export function createReferralTools(phone, repos, botPhone, displayName = "") {
  const businessLabel = displayName || "o serviço";

  const inviteCustomer = defineTool({
    name: "invite_customer",
    label: "Convidar Cliente",
    description: `Pré-autoriza um número de WhatsApp para usar ${businessLabel}.`,
    promptSnippet: "Convida um novo cliente por número de WhatsApp",
    promptGuidelines: [
      "Use quando o cliente fornecer o número de alguém para indicar.",
      "Normalize o número: remova espaços, parênteses, hífens. Inclua DDI 55 + DDD.",
      "Após convidar, informe que o convidado já pode mandar mensagem pro bot.",
    ],
    parameters: Type.Object({
      invited_phone: Type.String({ description: "Número do convidado (ex: 5541999998888)" }),
      invited_name:  Type.Optional(Type.String({ description: "Nome do convidado" })),
    }),
    async execute(_toolCallId, params) {
      const invitedPhone = params.invited_phone.replace(/\D/g, "");
      const existing = await repos.customers.getByPhone(invitedPhone);
      if (existing && existing.access_status !== "blocked") {
        return { content: [{ type: "text", text: `Esse número já tem acesso a ${businessLabel}!` }], details: { alreadyExists: true } };
      }

      const referrerCode = await repos.customers.ensureReferralCode(phone);
      await repos.customers.upsert(invitedPhone, { push_name: params.invited_name || null, access_status: "invited", referred_by_phone: phone });
      if (params.invited_name) await repos.customers.updateInfo(invitedPhone, { name: params.invited_name });
      await repos.customers.ensureReferralCode(invitedPhone);
      await repos.referrals.create(phone, invitedPhone, referrerCode);

      const referrer = await repos.customers.getByPhone(phone);
      const referrerName = referrer?.name || referrer?.push_name || "você";

      return {
        content: [{ type: "text", text: `Número ${invitedPhone} liberado! Quando essa pessoa mandar mensagem aqui, vai ser atendida. Quando fizer a primeira compra, ${referrerName} ganha 10% de desconto no próximo pedido.` }],
        details: { invitedPhone, referrerCode },
      };
    },
  });

  const getReferralInfo = defineTool({
    name: "get_referral_info",
    label: "Info de Indicação",
    description: "Retorna o código de indicação do cliente, link compartilhável e estatísticas.",
    promptSnippet: "Retorna código de indicação, link e stats",
    promptGuidelines: [
      "Use quando o cliente perguntar sobre indicação, código, ou quiser convidar alguém.",
    ],
    parameters: Type.Object({}),
    async execute() {
      const code = await repos.customers.ensureReferralCode(phone);
      const counts = await repos.referrals.countByReferrer(phone);
      const pendingRewards = await repos.referrals.getPendingRewards(phone);

      const link = botPhone
        ? `https://wa.me/${botPhone}?text=${encodeURIComponent(code)}`
        : null;

      const parts = [`Código de indicação: ${code}`];
      if (link) parts.push(`Link: ${link}`);
      parts.push(`Indicações: ${counts?.total || 0} (${counts?.active || 0} ativos)`);
      for (const r of pendingRewards) {
        const name = r.referred_name || r.referred_push_name || r.referred_phone;
        parts.push(`Recompensa pendente: ${name} comprou → ${r.reward_value}% desconto`);
      }

      return { content: [{ type: "text", text: parts.join("\n") }], details: { code, link, counts } };
    },
  });

  return [inviteCustomer, getReferralInfo];
}
