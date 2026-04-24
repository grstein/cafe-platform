#!/usr/bin/env node
/**
 * Continuous poll of the RabbitMQ management API. Prints a table of
 * queue depth, consumer count and rates at a fixed interval — a lightweight
 * alternative to opening the mgmt UI.
 *
 * Requires the management plugin and RABBITMQ_MGMT_URL (default
 * http://admin:password@localhost:15672).
 *
 * Usage:
 *   node scripts/sim/probe-queues.mjs
 *   node scripts/sim/probe-queues.mjs --interval 1000 --once
 */

import { parseArgs, probeQueues, sleep } from "./lib.mjs";

function pad(s, n) { return String(s).padEnd(n, " "); }
function rpad(s, n) { return String(s).padStart(n, " "); }

function printTable(rows) {
  const cols = [
    ["queue", 28],
    ["msgs", 8],
    ["ready", 8],
    ["unack", 8],
    ["cons", 5],
    ["pub/s", 8],
    ["ack/s", 8],
  ];
  const header = cols.map(([h, w]) => pad(h, w)).join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of rows) {
    console.log(
      pad(r.name.slice(0, 28), 28) + " " +
      rpad(r.messages, 8) + " " +
      rpad(r.messages_ready, 8) + " " +
      rpad(r.messages_unacknowledged, 8) + " " +
      rpad(r.consumers, 5) + " " +
      rpad(r.publish_rate.toFixed(1), 8) + " " +
      rpad(r.ack_rate.toFixed(1), 8)
    );
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const interval = Number(opts.interval) || 2000;
  const once = !!opts.once;

  let running = true;
  process.on("SIGINT", () => { running = false; });

  while (running) {
    try {
      const queues = await probeQueues();
      queues.sort((a, b) => a.name.localeCompare(b.name));
      console.log(`\n[${new Date().toISOString()}]`);
      printTable(queues);
    } catch (err) {
      console.error("probe error:", err.message);
    }
    if (once) break;
    await sleep(interval);
  }
}

main().catch(err => { console.error("probe-queues error:", err); process.exit(1); });
