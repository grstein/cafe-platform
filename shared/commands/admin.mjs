/**
 * @fileoverview Admin command dispatcher — privileged commands issued by the
 * bot operator from their own WhatsApp self-chat.
 *
 * Security: every handler re-verifies ctx.actor === "admin" as a defense-in-depth
 * gate. Bridge and gateway already filter, but this module never trusts upstream.
 */

import { publish } from "../lib/rabbitmq.mjs";
import { normalizeBrPhone } from "../lib/phone.mjs";

const SUBCOMMANDS = [
  { name: "autorizar", usage: "/admin autorizar <telefone>", desc: "Libera um número e envia mensagem de boas-vindas" },
];

function helpText() {
  const lines = ["🛡️ Comandos de admin", ""];
  for (const s of SUBCOMMANDS) lines.push(`${s.usage} — ${s.desc}`);
  return lines.join("\n");
}

function audit(adminPhone, sub, args, outcome) {
  console.log(`[admin][audit] phone=${adminPhone} sub=${sub} args=${JSON.stringify(args)} outcome=${outcome}`);
}

/**
 * @param {string} text   Raw message text from the admin self-chat
 * @param {object} ctx    { actor, phone, repos, channel, config }
 * @returns {Promise<{command:string, text:string} | null>}
 *          null if `text` is not an admin command (caller may fall through).
 */
export async function tryHandleAdmin(text, ctx) {
  const trimmed = text.trim();
  if (!/^\/admin(\s|$)/i.test(trimmed)) return null;

  if (ctx.actor !== "admin") {
    // Defense in depth: should never happen — gateway must not dispatch here
    // for non-admin actors. Refuse silently to avoid leaking the surface.
    audit(ctx.phone, "_reject_non_admin", { text: trimmed }, "refused");
    return null;
  }

  const rest = trimmed.replace(/^\/admin\s*/i, "").trim();
  if (!rest) {
    return { command: "/admin", text: helpText() };
  }

  const [sub, ...args] = rest.split(/\s+/);
  try {
    switch (sub.toLowerCase()) {
      case "autorizar": return await handleAutorizar(ctx, args);
      default:
        audit(ctx.phone, sub, args, "unknown_sub");
        return { command: "/admin", text: `Subcomando desconhecido: ${sub}\n\n${helpText()}` };
    }
  } catch (err) {
    console.error("[admin] handler error:", err);
    audit(ctx.phone, sub, args, `error:${err.message}`);
    return { command: "/admin", text: `Erro ao executar /admin ${sub}: ${err.message}` };
  }
}

async function handleAutorizar(ctx, args) {
  const raw = args[0];
  if (!raw) {
    return { command: "/admin autorizar", text: "Uso: /admin autorizar <telefone>\nEx: /admin autorizar 41999999999" };
  }

  const phone = normalizeBrPhone(raw);
  if (!phone) {
    audit(ctx.phone, "autorizar", { raw }, "invalid_phone");
    return { command: "/admin autorizar", text: `Número inválido: "${raw}". Use formato 41999999999 ou 5541999999999.` };
  }

  if (phone === ctx.phone) {
    audit(ctx.phone, "autorizar", { phone }, "self_authorize_refused");
    return { command: "/admin autorizar", text: "Não dá pra autorizar você mesmo." };
  }

  const result = await ctx.repos.customers.adminAuthorize(phone);
  audit(ctx.phone, "autorizar", { phone, ...result }, "ok");

  // Welcome message → published directly to the bridge's send queue, bypassing
  // the normal pipeline (the envelope's phone would be the admin's, not the
  // invitee's). Bypassing humanization is intentional: this is system-initiated.
  const displayName = ctx.config?.display_name || "nosso atendimento";
  const welcomeText = [
    `Olá! Você foi convidado para conversar com ${displayName}. ☕`,
    "",
    "Envie /ajuda para ver o que dá pra fazer por aqui.",
  ].join("\n");
  publish(ctx.channel, "msg.flow", "send", { phone, action: "text", text: welcomeText });

  const status = result.alreadyActive ? "já estava autorizado" : "autorizado";
  return {
    command: "/admin autorizar",
    text: `✓ ${phone} ${status}. Mensagem de boas-vindas enviada.`,
  };
}
