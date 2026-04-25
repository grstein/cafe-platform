/**
 * @fileoverview Gateway Consumer — entry point for all WhatsApp messages.
 *
 * Reads from:  gateway.incoming (msg.flow incoming)
 * Publishes to: msg.flow validated  (normal messages)
 *               msg.flow outgoing   (command responses, denials)
 */

import { connect, publish, consume, ack, nack } from "../shared/lib/rabbitmq.mjs";
import { createEnvelope, setStage, parseFromRabbitMQ, setResponse } from "../shared/lib/envelope.mjs";
import { loadConfig, getConfig } from "../shared/lib/config.mjs";
import { getDB, initDB } from "../shared/db/connection.mjs";
import { createCustomerRepo } from "../shared/db/customers.mjs";
import { createOrderRepo } from "../shared/db/orders.mjs";
import { createCartRepo } from "../shared/db/cart.mjs";
import { createReferralRepo } from "../shared/db/referrals.mjs";
import { createAllowlistRepo } from "../shared/db/allowlist.mjs";
import { createCommandHandlers } from "../shared/commands/index.mjs";
import { tryHandleAdmin } from "../shared/commands/admin.mjs";

const RABBITMQ_URI = process.env.RABBITMQ_URI;
const QUEUE = "gateway.incoming";
const PREFETCH = Number(process.env.PREFETCH) || 8;
const REFERRAL_CODE_PREFIX = process.env.REFERRAL_CODE_PREFIX || "REF-";
const _escapedPrefix = REFERRAL_CODE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CODE_PATTERN = new RegExp(`\\b${_escapedPrefix}[A-HJ-NP-Z2-9]{4}\\b`, "i");

const rateLimits = new Map();

// Allowlist in-memory cache
let _allowlistCache = null;
let _allowlistLoadedAt = 0;
const ALLOWLIST_TTL = 60 * 1000;

let repos = null;
function getRepos() {
  if (repos) return repos;
  const sql = getDB();
  repos = {
    customers: createCustomerRepo(sql),
    orders:    createOrderRepo(sql),
    cart:      createCartRepo(sql),
    referrals: createReferralRepo(sql),
    allowlist: createAllowlistRepo(sql),
  };
  return repos;
}

function parseIncomingPayload(raw) {
  const d = raw.data || raw;
  const key = d.key || {};
  const jid = key.remoteJid || "";
  if (jid.includes("@g.us") || jid.includes("@broadcast")) return null;
  const phone = jid.replace("@s.whatsapp.net", "");
  if (!phone) return null;
  const msg = d.message || {};
  const text = msg.conversation || msg.extendedTextMessage?.text || "";
  if (!text.trim()) return null;
  return { phone, text: text.trim(), pushName: d.pushName || "", fromMe: !!key.fromMe };
}

function checkRateLimit(phone, limit = 8) {
  const now = Date.now();
  let entry = rateLimits.get(phone);
  if (!entry || now - entry.windowStart > 60000) {
    entry = { count: 0, windowStart: now };
    rateLimits.set(phone, entry);
  }
  entry.count++;
  if (entry.count > 20) return "abuse";
  if (entry.count > limit) return "limited";
  return "ok";
}

/** Load (or return cached) allowlist from DB. */
async function getAllowlist(allowlistRepo) {
  const now = Date.now();
  if (_allowlistCache && now - _allowlistLoadedAt < ALLOWLIST_TTL) return _allowlistCache;

  const rows = await allowlistRepo.getPatterns();
  const exact = new Set();
  const prefixes = [];
  for (const { pattern } of rows) {
    if (pattern.endsWith("*")) prefixes.push(pattern.slice(0, -1));
    else exact.add(pattern);
  }
  _allowlistCache = { exact, prefixes };
  _allowlistLoadedAt = now;
  return _allowlistCache;
}

function isAllowlisted(phone, allowlist) {
  if (allowlist.exact.has(phone)) return true;
  return allowlist.prefixes.some(p => phone.startsWith(p));
}

async function main() {
  console.log("🟢 Gateway consumer starting...");
  await initDB();
  const sql = getDB();
  await loadConfig(sql);
  const { connection, channel } = await connect(RABBITMQ_URI);

  // Seed allowlist from file if DB is empty (first run)
  const r = getRepos();
  await r.allowlist.seedFromFile();

  consume(channel, QUEUE, async (msg) => {
    if (!msg) return;
    try {
      const raw = JSON.parse(msg.content.toString());
      const parsed = parseIncomingPayload(raw);
      if (!parsed) { ack(channel, msg); return; }

      const { phone, text, pushName, fromMe } = parsed;
      const config = getConfig();
      const botPhone = (process.env.BOT_PHONE || config.bot_phone || "").replace(/\D/g, "");
      const isAdmin = fromMe === true && !!botPhone && phone === botPhone;
      const actor = isAdmin ? "admin" : "customer";

      // Non-admin fromMe should already be filtered at the bridge; if one slips
      // through, drop it here as defense in depth (would otherwise loop).
      if (fromMe && !isAdmin) { ack(channel, msg); return; }

      // Non-admin /admin attempts: never leak the surface — silently ignore.
      if (!isAdmin && /^\/admin(\s|$)/i.test(text)) { ack(channel, msg); return; }

      // Admin path: bypass rate limits, allowlist, referral gate. Dispatch
      // /admin commands inline; non-command admin text falls through to the
      // normal flow so a future admin agent can handle it (actor stays "admin").
      if (isAdmin) {
        const adminResult = await tryHandleAdmin(text, {
          actor, phone, repos: r, channel, config,
        });
        if (adminResult) {
          const envelope = createEnvelope({ phone, text, pushName, actor });
          envelope.metadata.command_result = adminResult;
          if (adminResult.text) setResponse(envelope, adminResult.text);
          setStage(envelope, "outgoing");
          publish(channel, "msg.flow", "outgoing", envelope);
          ack(channel, msg);
          return;
        }
        // Non-command admin text — let it flow normally (future admin agent
        // will branch on metadata.actor === "admin").
        const envelope = createEnvelope({ phone, text, pushName, actor });
        setStage(envelope, "validated");
        publish(channel, "msg.flow", "validated", envelope);
        ack(channel, msg);
        return;
      }

      const rateLimit = config.behavior?.rate_limit_per_min || 8;
      const rateStatus = checkRateLimit(phone, rateLimit);
      if (rateStatus === "abuse" || rateStatus === "limited") { ack(channel, msg); return; }

      const allowlist = await getAllowlist(r.allowlist);
      const allowed = isAllowlisted(phone, allowlist);

      if (!allowed) {
        const customer = await r.customers.getByPhone(phone);
        if (!customer || customer.access_status === "blocked") {
          const codeMatch = text.match(CODE_PATTERN);
          if (codeMatch) {
            const code = codeMatch[0].toUpperCase();
            const referral = await r.referrals.validate(code);
            if (referral) {
              await r.customers.upsert(phone, { push_name: pushName, access_status: "invited", referred_by_phone: referral.referrer_phone });
              const referrer = await r.customers.getByPhone(referral.referrer_phone);
              const referrerName = referrer?.name || referrer?.push_name || "um amigo";
              const envelope = createEnvelope({ phone, text, pushName });
              setResponse(envelope, `Bem-vindo ao ${config.display_name || "nosso serviço"}! Você foi indicado por ${referrerName}. Me conta, o que procura? ☕`);
              setStage(envelope, "outgoing");
              publish(channel, "msg.flow", "outgoing", envelope);
              ack(channel, msg);
              return;
            }
          }
          console.log(`[gateway] Denied ${phone} (not in allowlist, no valid code)`);
          ack(channel, msg);
          return;
        }
      } else {
        await r.customers.upsert(phone, { push_name: pushName, access_status: "active" });
      }

      // Static commands
      const pixConfig = config.pix?.enabled
        ? { key: process.env.PIX_KEY, name: process.env.PIX_NAME || config.display_name, city: process.env.PIX_CITY || "São Paulo" }
        : null;

      const commands = createCommandHandlers(r, pixConfig, {
        botPhone:        process.env.BOT_PHONE || config.bot_phone || "",
        availableModels: config.available_models || [],
        defaultModelId:  config.llm?.model || "",
        displayName:     config.display_name || "",
        orderPrefix:     process.env.ORDER_PREFIX || "",
      });

      const cmdResult = await commands.tryHandle(text, phone);
      if (cmdResult) {
        const envelope = createEnvelope({ phone, text, pushName });
        envelope.metadata.command_result = cmdResult;
        if (cmdResult.narrate) {
          // Side effect já executado; agente narra o resultado no pipeline normal.
          setStage(envelope, "validated");
          publish(channel, "msg.flow", "validated", envelope);
          ack(channel, msg);
          return;
        }
        if (cmdResult.text) setResponse(envelope, cmdResult.text, cmdResult.messages || null);
        setStage(envelope, "outgoing");
        publish(channel, "msg.flow", "outgoing", envelope);
        if (cmdResult.resetSession) {
          publish(channel, "events", "session_reset", { phone });
        }
        ack(channel, msg);
        return;
      }

      // Normal message → aggregator
      const envelope = createEnvelope({ phone, text, pushName });
      setStage(envelope, "validated");
      publish(channel, "msg.flow", "validated", envelope);
      ack(channel, msg);
    } catch (err) {
      console.error("[gateway] Error:", err.message);
      nack(channel, msg, !msg.fields.redelivered);
    }
  }, { prefetch: PREFETCH });

  // Periodic cleanup
  setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [k, v] of rateLimits) { if (v.windowStart < cutoff) rateLimits.delete(k); }
  }, 5 * 60 * 1000);

  console.log(`🟢 Gateway listening on ${QUEUE}`);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      console.log(`🔴 Gateway shutting down (${sig})`);
      await channel.close(); await connection.close(); process.exit(0);
    });
  }
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
