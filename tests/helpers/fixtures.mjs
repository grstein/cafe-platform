/**
 * @fileoverview Shared test fixtures — phones, products, configs, payloads.
 */

import { createEnvelope } from "../../shared/lib/envelope.mjs";

// ── Phone numbers ──────────────────────────────────────────────
export const PHONES = {
  primary:   "5500000000001",
  secondary: "5500000000002",
  unknown:   "5500000000099",
  blocked:   "5500000000098",
};
// Legacy aliases
PHONES.gustavo = PHONES.primary;
PHONES.beta    = PHONES.secondary;

// ── Sample products ────────────────────────────────────────────
export const PRODUCTS = {
  mrChocolate: {
    sku: "CDA-MOKA-MRCHOC-250",
    name: "Mr. Chocolate",
    roaster: "Demo Roaster A",
    sca: 84,
    profile: "Achocolatado, encorpado",
    origin: "Cerrado Mineiro",
    process: "Natural",
    price: 48.00,
    cost: 27.00,
    weight: "250g",
    highlight: "porta de entrada",
  },
  honey: {
    sku: "CDA-LUCCA-HONEY-250",
    name: "Honey&Coffee",
    roaster: "Demo Roaster B",
    sca: 87,
    profile: "Mel, frutado, complexo",
    origin: "Mantiqueira de Minas",
    process: "Honey",
    price: 79.00,
    cost: 53.00,
    weight: "250g",
    highlight: "premium",
  },
  blend: {
    sku: "CDA-LUCCA-BLEND-250",
    name: "Blend Clássico",
    roaster: "Demo Roaster B",
    sca: 84,
    profile: "Equilibrado, versátil",
    origin: "Blend",
    process: "Natural/Lavado",
    price: 62.00,
    cost: 41.90,
    weight: "250g",
    highlight: "dia a dia",
  },
};

// ── App config ─────────────────────────────────────────────────
export const APP_CONFIG = {
  display_name: "Test Store",
  llm: { provider: "openrouter", model: "anthropic/claude-haiku-4.5", thinking: "medium" },
  session: { ttl_minutes: 30, soft_limit: 40, hard_limit: 60, debounce_ms: 2500 },
  behavior: { humanize_delay_min_ms: 2000, humanize_delay_max_ms: 6000, rate_limit_per_min: 8, typing_indicator: true },
  pix: { enabled: true },
  bot_phone: "5500000000000",
  available_models: [
    { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", emoji: "🐇" },
    { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", emoji: "🧠" },
  ],
};

// Keep alias for backward compat
export const TENANT_CONFIG = APP_CONFIG;

// ── Incoming WhatsApp payload ──────────────────────────────────
export function EVOLUTION_PAYLOAD(text, phone, overrides = {}) {
  const p = phone || PHONES.primary;
  return {
    instance: overrides.instance || "Test Store",
    data: {
      key: {
        remoteJid: `${p}@s.whatsapp.net`,
        fromMe: overrides.fromMe || false,
        id: "ABCDEF123456",
      },
      pushName: overrides.pushName || "Customer",
      message: { conversation: text },
      messageType: "conversation",
    },
  };
}

// ── Envelope factory ───────────────────────────────────────────
export function ENVELOPE(overrides = {}) {
  const env = createEnvelope({
    phone:    overrides.phone    || PHONES.primary,
    channel:  overrides.channel  || "whatsapp",
    text:     overrides.text     || "Quero um café",
    pushName: overrides.pushName || "Customer",
  });
  if (overrides.context) Object.assign(env.context, overrides.context);
  if (overrides.stage)   env.metadata.stage = overrides.stage;
  return env;
}

// ── PIX config ─────────────────────────────────────────────────
export const PIX_CONFIG = {
  key:  "00000000000",
  name: "TEST MERCHANT",
  city: "TEST CITY",
};
