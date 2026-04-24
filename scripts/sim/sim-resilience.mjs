#!/usr/bin/env node
/**
 * Resilience simulator — starts a moderate load, restarts one consumer
 * container mid-flight via docker compose, and verifies every message
 * either completes or ends up in dead-letters (no silent loss).
 *
 * Usage:
 *   node scripts/sim/sim-resilience.mjs --target enricher --messages 40 --phones 8
 *   node scripts/sim/sim-resilience.mjs --target agent --delayMs 3000
 *
 * Requires docker compose in PATH. Falls back to read-only warning if absent.
 */

import { execSync, spawn } from "child_process";
import {
  getRabbitUri, parseArgs, publishFakeIncoming, listenCompleted, sleep,
  simPhone, connect, probeQueues,
} from "./lib.mjs";

function haveDocker() {
  try {
    execSync("docker compose version", { stdio: "ignore" });
    return true;
  } catch { return false; }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target   = String(opts.target   || "enricher");
  const total    = Number(opts.messages) || 40;
  const phones   = Number(opts.phones)   || 8;
  const rate     = Number(opts.rate)     || 10;
  const delayMs  = Number(opts.delayMs)  || 2000;
  const timeout  = Number(opts.timeout)  || 60000;
  const uri = getRabbitUri();

  if (!haveDocker()) {
    console.warn("⚠️  docker compose not available — running in read-only mode (no restart)");
  }

  console.log(`🔬 sim-resilience: target=${target} ${total} msgs across ${phones} phones`);

  const pending = new Map();
  const matched = [];
  const matchedPhones = new Set();
  for (let i = 0; i < phones; i++) matchedPhones.add(simPhone(5000 + i));

  let resolveDone;
  const done = new Promise(r => { resolveDone = r; });

  const stopListen = await listenCompleted(uri, (data) => {
    if (!matchedPhones.has(data.phone)) return;
    const q = pending.get(data.phone);
    if (!q || !q.length) return;
    const now = Date.now();
    while (q.length) matched.push(now - q.shift());
    for (const v of pending.values()) if (v.length) return;
    if (pending.size > 0) resolveDone();
  });

  const { connection, channel } = await connect(uri);
  const intervalMs = 1000 / rate;
  for (let i = 0; i < total; i++) {
    const phone = simPhone(5000 + (i % phones));
    if (!pending.has(phone)) pending.set(phone, []);
    pending.get(phone).push(Date.now());
    publishFakeIncoming(channel, { phone, text: `resil ${i}` });
    await sleep(intervalMs);
  }

  if (haveDocker()) {
    await sleep(delayMs);
    console.log(`💥 Restarting container: ${target}`);
    try {
      execSync(`docker compose restart ${target}`, { stdio: "inherit" });
    } catch (err) {
      console.error("restart failed:", err.message);
    }
  }

  const timeoutTimer = setTimeout(() => resolveDone("timeout"), timeout);
  const why = await done;
  clearTimeout(timeoutTimer);

  await channel.close();
  await connection.close();
  await stopListen();

  // Probe DLQ
  let dlq = 0;
  try {
    const queues = await probeQueues();
    const dl = queues.find(q => q.name === "dead-letters");
    dlq = dl ? dl.messages : 0;
  } catch {}

  let stillPending = 0;
  for (const q of pending.values()) stillPending += q.length;

  const report = {
    params: { target, total, phones, rate, delayMs },
    matched: matched.length,
    still_pending: stillPending,
    dead_letters: dlq,
    timed_out: why === "timeout",
    pass: stillPending === 0 && why !== "timeout",
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main().catch(err => { console.error("sim-resilience error:", err); process.exit(1); });
