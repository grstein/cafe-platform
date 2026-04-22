import fs from "fs";
import path from "path";
import http from "http";
import { connect, publish, consume, ack } from "../shared/lib/rabbitmq.mjs";
import { createBaileysConnection } from "../shared/lib/baileys-client.mjs";
import { getConfig } from "../shared/lib/config.mjs";

const RABBITMQ_URI = process.env.RABBITMQ_URI;
const DATA_DIR = process.env.DATA_DIR || "./data";
const QR_PORT = parseInt(process.env.QR_PORT || "3001", 10);

let qrCode = null;
let connection = null;

async function main() {
  console.log("🟢 WhatsApp Bridge starting...");
  const { connection: rmqConn, channel } = await connect(RABBITMQ_URI);
  const config = getConfig();

  const instanceName = config.channel?.instance_name || config.display_name || config.tenant_id;
  const authDir = path.join(DATA_DIR, config.tenant_id, "auth");

  console.log(`   Connecting instance: ${instanceName}`);

  connection = await createBaileysConnection({
    tenantId: config.tenant_id,
    authDir,
    onMessage(msg) {
      const payload = baileysMessageToPayload(msg, instanceName);
      publish(channel, "msg.flow", "incoming", payload);
    },
    onQR(qr) {
      qrCode = qr;
      console.log(`[bridge] QR ready — open http://localhost:${QR_PORT} to scan`);
    },
    onConnect() {
      qrCode = null;
      console.log("[bridge] WhatsApp connected ✓");
    },
    onDisconnect(reason) {
      console.error(`[bridge] Disconnected: ${reason}`);
      connection = null;
    },
  });

  // Consume outgoing messages
  await channel.assertQueue("whatsapp.send", {
    durable: true,
    arguments: { "x-dead-letter-exchange": "dlx" },
  });
  await channel.bindQueue("whatsapp.send", "msg.flow", "send");

  consume(channel, "whatsapp.send", async (msg) => {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString());
      const { phone, action, text, state } = payload;
      console.log(`[bridge] Outgoing: ${action} to=${phone}`);

      if (!connection) {
        console.warn("[bridge] No active WhatsApp connection");
        ack(channel, msg);
        return;
      }

      if (action === "presence") {
        await connection.sendPresence(phone, state || "composing");
      } else if (action === "text") {
        const result = await connection.sendText(phone, text);
        if (result.ok) console.log(`[bridge] Sent to ${phone} (${text.length} chars)`);
        else console.error(`[bridge] Send failed:`, result.error);
      }

      ack(channel, msg);
    } catch (err) {
      console.error("[bridge] Error:", err.message);
      ack(channel, msg);
    }
  });

  // QR code HTTP server
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      const status = qrCode
        ? `<a href="/qr">Aguardando QR scan</a>`
        : connection ? "Conectado ✓" : "Desconectado";
      res.end(`<h1>WhatsApp Bridge</h1><p>${instanceName}: ${status}</p>`);
      return;
    }
    if (req.url === "/qr") {
      if (!qrCode) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<p>${connection ? "Conectado ✓" : "Aguardando QR..."}</p><script>setTimeout(()=>location.reload(),5000)</script>`);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR</title>
<script src="https://cdn.jsdelivr.net/npm/qrcode@1/build/qrcode.min.js"></script>
</head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;background:#111;color:#fff">
<h2>${instanceName}</h2><canvas id="qr"></canvas><p>Escaneie com WhatsApp</p>
<script>QRCode.toCanvas(document.getElementById('qr'),${JSON.stringify(qrCode)},{width:300,margin:2,color:{dark:'#fff',light:'#111'}});setTimeout(()=>location.reload(),20000)</script>
</body></html>`);
      return;
    }
    res.writeHead(404); res.end();
  });
  server.listen(QR_PORT, () => console.log(`🔗 QR code page at http://localhost:${QR_PORT}`));

  console.log("🟢 WhatsApp Bridge ready");

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      console.log(`🔴 Bridge shutting down (${sig})`);
      if (connection) connection.disconnect();
      await channel.close();
      await rmqConn.close();
      process.exit(0);
    });
  }
}

function baileysMessageToPayload(msg, instanceName) {
  const jid = msg.key.remoteJid || "";
  const text = msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || "";
  return {
    instance: instanceName,
    data: {
      key: {
        remoteJid: jid,
        fromMe: msg.key.fromMe || false,
        id: msg.key.id || "",
      },
      pushName: msg.pushName || "",
      message: text ? { conversation: text } : msg.message || {},
      messageType: msg.message?.conversation ? "conversation" : "extendedTextMessage",
    },
  };
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
