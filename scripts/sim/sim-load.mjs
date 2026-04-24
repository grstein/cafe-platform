#!/usr/bin/env node
/**
 * Load simulator — publishes N "incoming" payloads spread across M phones
 * at a target rate, then waits for the matching `events/completed` signals
 * from the sender and reports end-to-end latency percentiles.
 *
 * Usage:
 *   node scripts/sim/sim-load.mjs --messages 200 --phones 20 --rate 20
 *   node scripts/sim/sim-load.mjs --messages 50 --phones 5 --timeout 60000
 *
 * Notes:
 *   - Measures total pipeline latency (publish → completed event).
 *   - Does NOT exercise the WhatsApp bridge; tests gateway-onward.
 *   - The aggregator may merge multiple messages per phone inside its debounce
 *     window (2.5s default). This script therefore pairs each completed event
 *     with the *oldest* pending publish for that phone, and reports
 *     completed < total as a merge count — not a loss.
 */

import {
  getRabbitUri, parseArgs, summarizeLatencies, publishFakeIncoming,
  listenCompleted, sleep, simPhone, connect,
} from "./lib.mjs";

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const total    = Number(opts.messages) || 100;
  const phones   = Number(opts.phones)   || 10;
  const rate     = Number(opts.rate)     || 10;   // msg/s
  const timeout  = Number(opts.timeout)  || 120000;
  const uri      = getRabbitUri();

  console.log(`🔬 sim-load: ${total} msgs across ${phones} phones @ ${rate} msg/s`);

  /** phone -> array of publish timestamps (FIFO) */
  const pending = new Map();
  const latencies = [];
  let resolveDone;
  const done = new Promise(r => { resolveDone = r; });

  const matchedPhones = new Set();
  for (let i = 0; i < phones; i++) matchedPhones.add(simPhone(i));

  function checkDone() {
    // done when every phone's pending queue is empty
    for (const q of pending.values()) if (q.length) return;
    if (pending.size > 0) resolveDone();
  }

  const stopListen = await listenCompleted(uri, (data) => {
    if (!matchedPhones.has(data.phone)) return;
    const q = pending.get(data.phone);
    if (!q || !q.length) return;
    // Drain ALL pending publishes for this phone — a single completed means
    // the aggregator merged them into one batch.
    const now = Date.now();
    while (q.length) latencies.push(now - q.shift());
    checkDone();
  });

  const { connection, channel } = await connect(uri);
  const intervalMs = 1000 / rate;
  const t0 = Date.now();

  for (let i = 0; i < total; i++) {
    const phone = simPhone(i % phones);
    if (!pending.has(phone)) pending.set(phone, []);
    pending.get(phone).push(Date.now());
    publishFakeIncoming(channel, { phone, text: `sim ${i}` });
    await sleep(intervalMs);
  }
  const publishElapsed = Date.now() - t0;
  console.log(`📤 Published ${total} msgs in ${publishElapsed}ms`);

  const timeoutTimer = setTimeout(() => resolveDone("timeout"), timeout);
  const why = await done;
  clearTimeout(timeoutTimer);

  let unmatched = 0;
  for (const q of pending.values()) unmatched += q.length;

  const stats = summarizeLatencies(latencies);
  const report = {
    params: { total, phones, rate },
    published_ms: publishElapsed,
    matched: latencies.length,
    unmatched,
    timed_out: why === "timeout",
    latency_ms: stats,
  };
  console.log(JSON.stringify(report, null, 2));

  await channel.close();
  await connection.close();
  await stopListen();
  process.exit(why === "timeout" ? 2 : 0);
}

main().catch(err => { console.error("sim-load error:", err); process.exit(1); });
