#!/usr/bin/env node
/**
 * Rapid-fire simulator — sends a burst of messages to one phone in a tight
 * window and verifies the aggregator merges them into a single `completed`.
 *
 * Usage:
 *   node scripts/sim/sim-rapid-fire.mjs
 *   node scripts/sim/sim-rapid-fire.mjs --burst 5 --interval 400 --iterations 3
 */

import {
  getRabbitUri, parseArgs, publishFakeIncoming, listenCompleted, sleep,
  simPhone, connect,
} from "./lib.mjs";

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const burst      = Number(opts.burst)      || 5;
  const interval   = Number(opts.interval)   || 400;   // ms between sends
  const iterations = Number(opts.iterations) || 1;
  const waitAfter  = Number(opts.waitAfter)  || 10000; // ms to wait for completed after last send
  const uri = getRabbitUri();

  console.log(`🔬 sim-rapid-fire: ${iterations}× burst of ${burst} msgs, ${interval}ms apart`);

  let iterationResults = [];

  for (let it = 0; it < iterations; it++) {
    const phone = simPhone(1000 + it); // distinct phone per iteration
    const completedCount = { n: 0 };
    const firstCompletedAt = { t: 0 };
    const tStart = Date.now();

    const stopListen = await listenCompleted(uri, (data) => {
      if (data.phone !== phone) return;
      completedCount.n++;
      if (!firstCompletedAt.t) firstCompletedAt.t = Date.now();
    });

    const { connection, channel } = await connect(uri);
    for (let i = 0; i < burst; i++) {
      publishFakeIncoming(channel, { phone, text: `rapid ${it}.${i}` });
      if (i < burst - 1) await sleep(interval);
    }
    await sleep(waitAfter);
    await channel.close();
    await connection.close();
    await stopListen();

    const pass = completedCount.n === 1;
    iterationResults.push({
      iteration: it,
      phone,
      burst,
      completed_count: completedCount.n,
      merge_latency_ms: firstCompletedAt.t ? firstCompletedAt.t - tStart : null,
      pass,
    });
    console.log(
      `  it=${it} phone=${phone} burst=${burst} completed=${completedCount.n} ` +
      (pass ? "✅ merged" : "❌ EXPECTED 1 completed")
    );
  }

  const allPass = iterationResults.every(r => r.pass);
  console.log(JSON.stringify({ pass: allPass, iterations: iterationResults }, null, 2));
  process.exit(allPass ? 0 : 1);
}

main().catch(err => { console.error("sim-rapid-fire error:", err); process.exit(1); });
