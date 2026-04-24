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
const PREFETCH = Number(process.env.PREFETCH) || 16;

const logger = createLogger(LOG_DIR);
let customerRepo = null;

/**
 * Extract per-stage latencies (ms) from envelope.metadata.timings.
 * Timings are ISO strings set by setStage() at each transition.
 * Returns null when there are fewer than 2 stages to diff.
 */
export function extractStageTimings(timings) {
  if (!timings || typeof timings !== "object") return null;
  const entries = Object.entries(timings)
    .map(([transition, iso]) => ({ transition, t: Date.parse(iso) }))
    .filter(e => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t);
  if (entries.length < 2) return null;

  const stages = {};
  for (let i = 1; i < entries.length; i++) {
    const name = entries[i].transition;
    stages[name] = entries[i].t - entries[i - 1].t;
  }
  const end_to_end = entries[entries.length - 1].t - entries[0].t;
  return { end_to_end, stages };
}

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

          const timings = extractStageTimings(envelope.metadata?.timings);
          if (timings) {
            logger.log("PIPELINE_TIMING", phone, {
              stage,
              end_to_end_ms: timings.end_to_end,
              stages_ms: timings.stages,
              is_command: isCommand,
              batch_count: envelope.payload?.batch_count || 1,
              correlation_id: envelope.correlation_id,
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
  }, { prefetch: PREFETCH });

  console.log(`🟢 Analytics listening on ${QUEUE}`);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      console.log(`🔴 Analytics shutting down (${sig})`);
      await channel.close(); await connection.close(); process.exit(0);
    });
  }
}

// Only auto-run when invoked as a script (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error("Fatal:", err); process.exit(1); });
}
