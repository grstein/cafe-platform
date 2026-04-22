/**
 * @fileoverview Gateway Consumer — entry point for all WhatsApp messages.
 *
 * Reads from: gateway.incoming (msg.flow incoming)
 * Publishes to: msg.flow validated  (normal messages)
 *               msg.flow outgoing   (command responses, denials)
 */

import fs from "fs";
import { connect, publish, consume, ack, nack } from "../shared/lib/rabbitmq.mjs";
import { createEnvelope, setStage, parseFromRabbitMQ, setResponse } from "../shared/lib/envelope.mjs";
import { getConfig } from "../shared/lib/config.mjs";
import { getDB } from "../shared/db/connection.mjs";
import { createCustomerRepo } from "../shared/db/customers.mjs";
import { createOrderRepo } from "../shared/db/orders.mjs";
import { createCartRepo } from "../shared/db/cart.mjs";
import { createReferralRepo } from "../shared/db/referrals.mjs";
import { createCommandHandlers } from "../shared/commands/index.mjs";
import { generatePixCode } from "../shared/lib/pix.mjs";

const RABBITMQ_URI = process.env.RABBITMQ_URI;
const QUEUE = "gateway.incoming";
const REFERRAL_CODE_PREFIX = process.env.REFERRAL_CODE_PREFIX || "REF-";
const _escapedPrefix = REFERRAL_CODE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CODE_PATTERN = new RegExp(`\\b${_escapedPrefix}[A-HJ-NP-Z2-9]{4}\\b`, "i");
const PROMPT_COOLDOWN = 5 * 60 * 1000;

// In-memory state
const rateLimits = new Map();
const promptCooldowns = new Map();
let _allowlist = null;
let _allowlistLoadedAt = 0;
const ALLOWLIST_TTL = 60 * 1000;

// Repos (initialized once)
let repos = null;

function getRepos() {
  if (repos) return repos;
  const db = getDB(process.env.DATA_DIR);
  repos = {
    customers: createCustomerRepo(db),
    orders: createOrderRepo(db),
    cart: createCartRepo(db),
    referrals: createReferralRepo(db),
  };
  return repos;
}

function parseIncomingPayload(raw) {
  const d = raw.data || raw;
  const key = d.key || {};
  if (key.fromMe) return null;
  const jid = key.remoteJid || "";
  if (jid.includes("@g.us") || jid.includes("@broadcast")) return null;
  const phone = jid.replace("@s.whatsapp.net", "");
  if (!phone) return null;
  const msg = d.message || {};
  const text = msg.conversation || msg.extendedTextMessage?.text || "";
  if (!text.trim()) return null;
  return { phone, text: text.trim(), pushName: d.pushName || "" };
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

function loadAllowlist(config) {
  const now = Date.now();
  if (_allowlist && now - _allowlistLoadedAt < ALLOWLIST_TTL) return _allowlist;

  const file = config._paths?.allowlist;
  if (!file || !fs.existsSync(file)) {
    _allowlist = { exact: new Set(), prefixes: [] };
    _allowlistLoadedAt = now;
    return _allowlist;
  }

  const raw = fs.readFileSync(file, "utf-8");
  const exact = new Set();
  const prefixes = [];
  for (const line of raw.split("\n")) {
    const entry = line.split("#")[0].trim();
    if (!entry) continue;
    if (entry.endsWith("*")) prefixes.push(entry.slice(0, -1));
    else exact.add(entry);
  }
  _allowlist = { exact, prefixes };
  _allowlistLoadedAt = now;
  return _allowlist;
}

function isAllowlisted(phone, allowlist) {
  if (allowlist.exact.has(phone)) return true;
  return allowlist.prefixes.some(p => phone.startsWith(p));
}

async function main() {
  console.log("🟢 Gateway consumer starting...");
  const { connection, channel } = await connect(RABBITMQ_URI);
  const config = getConfig();

  consume(channel, QUEUE, async (msg) => {
    if (!msg) return;
    try {
      const raw = JSON.parse(msg.content.toString());
      const parsed = parseIncomingPayload(raw);
      if (!parsed) { ack(channel, msg); return; }

      const { phone, text, pushName } = parsed;
      const rateLimit = config.behavior?.rate_limit_per_min || 8;

      // Rate limiting
      const rateStatus = checkRateLimit(phone, rateLimit);
      if (rateStatus === "abuse" || rateStatus === "limited") { ack(channel, msg); return; }

      const r = getRepos();
      const allowlist = loadAllowlist(config);
      const allowed = isAllowlisted(phone, allowlist);

      if (!allowed) {
        const customer = r.customers.getByPhone(phone);
        if (!customer || customer.access_status === "blocked") {
          const codeMatch = text.match(CODE_PATTERN);
          if (codeMatch) {
            const code = codeMatch[0].toUpperCase();
            const referral = r.referrals.validate(code);
            if (referral) {
              r.customers.upsert(phone, { push_name: pushName, access_status: "invited", referred_by_phone: referral.referrer_phone });
              const referrerName = r.customers.getByPhone(referral.referrer_phone)?.name || "um amigo";
              const envelope = createEnvelope({ phone, text, pushName });
              setResponse(envelope, `Bem-vindo ao ${config.display_name}! Você foi indicado por ${referrerName}. Me conta, o que procura em café? ☕`);
              setStage(envelope, "outgoing");
              publish(channel, "msg.flow", "outgoing", envelope);
              ack(channel, msg);
              return;
            }
          }
          const lastPrompt = promptCooldowns.get(phone);
          if (!lastPrompt || Date.now() - lastPrompt > PROMPT_COOLDOWN) {
            promptCooldowns.set(phone, Date.now());
            const envelope = createEnvelope({ phone, text, pushName });
            setResponse(envelope, `Olá! O ${config.display_name} funciona por indicação. Se você tem um código, envie ele aqui (formato ${REFERRAL_CODE_PREFIX}XXXX). Se não, peça a indicação de alguem que já é cliente! ☕`);
            setStage(envelope, "outgoing");
            publish(channel, "msg.flow", "outgoing", envelope);
          }
          ack(channel, msg);
          return;
        }
      } else {
        r.customers.upsert(phone, { push_name: pushName, access_status: "active" });
      }

      // Static commands
      const pixConfig = config.pix?.enabled
        ? { key: process.env.PIX_KEY, name: process.env.PIX_NAME || config.display_name, city: process.env.PIX_CITY || "Curitiba" }
        : null;
      const commands = createCommandHandlers(r, pixConfig, {
        botPhone: process.env.BOT_PHONE || config.bot_phone || "",
        availableModels: config.available_models || [],
        defaultModelId: config.llm?.model || "",
        displayName: config.display_name || "",
        orderPrefix: process.env.ORDER_PREFIX || "",
      });
      const cmdResult = commands.tryHandle(text, phone);
      if (cmdResult) {
        const envelope = createEnvelope({ phone, text, pushName });
        envelope.metadata.command_result = cmdResult;
        if (cmdResult.text) setResponse(envelope, cmdResult.text, cmdResult.messages || null);
        setStage(envelope, "outgoing");
        publish(channel, "msg.flow", "outgoing", envelope);
        if (cmdResult.resetSession) {
          publish(channel, "events", "session_reset", { tenant_id: config.tenant_id, phone });
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
  });

  // Periodic cleanup
  setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [k, v] of rateLimits) { if (v.windowStart < cutoff) rateLimits.delete(k); }
    for (const [k, v] of promptCooldowns) { if (v < cutoff) promptCooldowns.delete(k); }
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
