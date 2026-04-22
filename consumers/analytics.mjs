/**
 * @fileoverview Analytics Consumer — logging and CRM updates.
 *
 * Reads from:   analytics.events (events #)
 * Publishes to: nothing (terminal consumer)
 */

import { connect, consume, ack } from "../shared/lib/rabbitmq.mjs";
import { parseFromRabbitMQ } from "../shared/lib/envelope.mjs";
import { createLogger } from "../shared/lib/logger.mjs";
import { getDB, initDB } from "../shared/db/connection.mjs";
import { loadConfig } from "../shared/lib/config.mjs";
import { createCustomerRepo } from "../shared/db/customers.mjs";

const RABBITMQ_URI = process.env.RABBITMQ_URI;
const LOG_DIR = process.env.LOG_DIR || "./logs";
const QUEUE = "analytics.events";

const logger = createLogger(LOG_DIR);
let customerRepo = null;

function getCustomerRepo() {
  if (customerRepo) return customerRepo;
  customerRepo = createCustomerRepo(getDB());
  return customerRepo;
}

async function main() {
  console.log("🟢 Analytics consumer starting...");
  await initDB();
  await loadConfig(getDB());
  const { connection, channel } = await connect(RABBITMQ_URI);

  consume(channel, QUEUE, async (msg) => {
    if (!msg) return;
    try {
      const envelope = parseFromRabbitMQ(msg);
      const stage = envelope.metadata?.stage || "unknown";
      const phone = envelope.phone || "";

      switch (stage) {
        case "outgoing":
        case "response": {
          const cmdResult = envelope.metadata?.command_result;
          const responseText = envelope.payload?.response_text || cmdResult?.text || "";
          const isCommand = !!cmdResult;
          logger.log(isCommand ? "CMD_OUT" : "MSG_OUT", phone, {
            text: responseText,
            command: cmdResult?.command,
            batch_count: envelope.payload?.batch_count || 1,
            correlation_id: envelope.correlation_id,
          });

          if (envelope.payload?.merged_text) {
            logger.log("MSG_IN", phone, {
              text: envelope.payload.merged_text,
              pushName: envelope.payload.messages?.[0]?.pushName,
              batch_count: envelope.payload.batch_count,
            });
          }

          try { await getCustomerRepo().upsert(phone, {}); } catch {}
          break;
        }
        default:
          logger.log(stage.toUpperCase(), phone, { correlation_id: envelope.correlation_id });
      }

      ack(channel, msg);
    } catch (err) {
      console.error("[analytics] Error:", err.message);
      ack(channel, msg);
    }
  });

  console.log(`🟢 Analytics listening on ${QUEUE}`);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      console.log(`🔴 Analytics shutting down (${sig})`);
      await channel.close(); await connection.close(); process.exit(0);
    });
  }
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
