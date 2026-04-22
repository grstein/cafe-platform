import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import fs from "fs";
import path from "path";

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000, 60000];

// LID-to-phone mapping cache (populated from contacts)
const lidMap = new Map();

function lidToPhone(sock, lid) {
  if (lidMap.has(lid)) return lidMap.get(lid);
  return null;
}

export async function createBaileysConnection({ label, authDir, onMessage, onQR, onConnect, onDisconnect }) {
  const tenantId = label || "bridge"; // kept as local label for log messages only
  fs.mkdirSync(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  let reconnectAttempt = 0;
  let sock;

  function toJid(phone) {
    return phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;
  }

  async function startSocket() {
    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ["CafePlatform", "Server", "1.0.0"],
      generateHighQualityLinkPreview: false,
      shouldSyncHistoryMessage: () => false,
      fireInitQueries: true,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`[baileys][${tenantId}] QR code generated — scan with WhatsApp`);
        qrcode.generate(qr, { small: true });
        const qrFile = path.join(authDir, "..", "qr.txt");
        fs.writeFileSync(qrFile, qr);
        if (onQR) onQR(qr);
      }

      if (connection === "open") {
        console.log(`[baileys][${tenantId}] Connected`);
        reconnectAttempt = 0;
        const qrFile = path.join(authDir, "..", "qr.txt");
        if (fs.existsSync(qrFile)) fs.unlinkSync(qrFile);
        if (onConnect) onConnect();
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = DisconnectReason;

        if (statusCode === reason.loggedOut) {
          console.error(`[baileys][${tenantId}] Logged out — clearing auth and waiting for re-pair`);
          fs.rmSync(authDir, { recursive: true, force: true });
          if (onDisconnect) onDisconnect("loggedOut");
          return;
        }

        const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)];
        reconnectAttempt++;
        console.warn(`[baileys][${tenantId}] Disconnected (code ${statusCode}), reconnecting in ${delay}ms...`);
        setTimeout(startSocket, delay);
      }
    });

    // Build LID→phone mapping from contacts
    sock.ev.on("contacts.upsert", (contacts) => {
      for (const contact of contacts) {
        if (contact.lid && contact.id?.endsWith("@s.whatsapp.net")) {
          lidMap.set(contact.lid, contact.id);
        }
      }
      console.log(`[baileys][${tenantId}] Contact map updated: ${lidMap.size} LID mappings`);
    });

    sock.ev.on("contacts.update", (updates) => {
      for (const update of updates) {
        if (update.lid && update.id?.endsWith("@s.whatsapp.net")) {
          lidMap.set(update.lid, update.id);
        }
      }
    });

    sock.ev.on("messages.upsert", (upsert) => {
      const { messages, type } = upsert;
      if (type !== "notify") return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        // Resolve LID (@lid) to phone JID (@s.whatsapp.net)
        const jid = msg.key.remoteJid || "";
        if (jid.endsWith("@lid")) {
          const alt = msg.key.remoteJidAlt;
          if (alt?.endsWith("@s.whatsapp.net")) {
            msg.key.remoteJid = alt;
          } else {
            const resolved = lidToPhone(sock, jid);
            if (resolved) {
              msg.key.remoteJid = resolved;
            } else {
              console.warn(`[baileys][${tenantId}] Cannot resolve LID ${jid}`);
              continue;
            }
          }
        }
        console.log(`[baileys][${tenantId}] msg from=${msg.key.remoteJid} type=${Object.keys(msg.message || {}).join(",")}`);
        if (onMessage) onMessage(msg);
      }
    });
  }

  await startSocket();

  return {
    async sendText(phone, text) {
      try {
        await sock.sendMessage(toJid(phone), { text });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async sendPresence(phone, presenceState) {
      try {
        await sock.presenceSubscribe(toJid(phone));
        await sock.sendPresenceUpdate(presenceState, toJid(phone));
      } catch {
        /* best-effort */
      }
    },

    disconnect() {
      sock?.end(undefined);
    },

    get socket() { return sock; },
  };
}
