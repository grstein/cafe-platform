#!/usr/bin/env node
/**
 * Bench orchestrator — runs sim-load against a predefined profile, probes the
 * queues during the run, and writes a markdown report to
 * docs/reference/performance-runs/<timestamp>.md.
 *
 * Usage:
 *   node scripts/sim/bench-report.mjs
 *   node scripts/sim/bench-report.mjs --label baseline --phones 10 --messages 100
 *   node scripts/sim/bench-report.mjs --label optimized
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { parseArgs, probeQueues, sleep } from "./lib.mjs";

function runSimLoad(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["scripts/sim/sim-load.mjs", ...args], { env: process.env });
    let out = "";
    proc.stdout.on("data", d => { out += d; process.stdout.write(d); });
    proc.stderr.on("data", d => process.stderr.write(d));
    proc.on("close", code => {
      const jsonStart = out.lastIndexOf("{");
      if (jsonStart < 0) return reject(new Error("no JSON report from sim-load"));
      try { resolve(JSON.parse(out.slice(jsonStart))); }
      catch (err) { reject(err); }
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const label    = String(opts.label || "run");
  const messages = Number(opts.messages) || 100;
  const phones   = Number(opts.phones)   || 10;
  const rate     = Number(opts.rate)     || 10;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = "docs/reference/performance-runs";
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${ts}-${label}.md`);

  // Background queue probing
  const probeSamples = [];
  let probing = true;
  (async () => {
    while (probing) {
      try {
        const queues = await probeQueues();
        probeSamples.push({ t: Date.now(), queues });
      } catch {}
      await sleep(1000);
    }
  })();

  const report = await runSimLoad([
    "--messages", String(messages),
    "--phones",   String(phones),
    "--rate",     String(rate),
  ]);
  probing = false;
  await sleep(1500);

  // Aggregate max depth per queue seen during the run
  const peak = {};
  for (const s of probeSamples) {
    for (const q of s.queues) {
      if (!peak[q.name] || q.messages > peak[q.name]) peak[q.name] = q.messages;
    }
  }

  const lines = [];
  lines.push(`# Pipeline Bench — ${label}`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Parameters");
  lines.push("");
  lines.push(`- Messages: **${messages}**`);
  lines.push(`- Phones: **${phones}**`);
  lines.push(`- Publish rate: **${rate} msg/s**`);
  lines.push("");
  lines.push("## End-to-end latency");
  lines.push("");
  const s = report.latency_ms;
  lines.push(`| metric | ms |`);
  lines.push(`|--------|----|`);
  lines.push(`| count  | ${s.count || 0} |`);
  lines.push(`| p50    | ${s.p50 ?? "-"} |`);
  lines.push(`| p95    | ${s.p95 ?? "-"} |`);
  lines.push(`| p99    | ${s.p99 ?? "-"} |`);
  lines.push(`| max    | ${s.max ?? "-"} |`);
  lines.push("");
  lines.push(`- Published in: **${report.published_ms} ms**`);
  lines.push(`- Matched completions: **${report.matched}**`);
  lines.push(`- Unmatched at timeout: **${report.unmatched}**`);
  lines.push(`- Timed out: **${report.timed_out}**`);
  lines.push("");
  lines.push("## Peak queue depth during run");
  lines.push("");
  lines.push(`| queue | peak |`);
  lines.push(`|-------|------|`);
  const sortedQueues = Object.entries(peak).sort((a, b) => b[1] - a[1]);
  for (const [name, n] of sortedQueues) lines.push(`| ${name} | ${n} |`);
  lines.push("");

  fs.writeFileSync(outFile, lines.join("\n"));
  console.log(`\n📄 Report written: ${outFile}`);
}

main().catch(err => { console.error("bench-report error:", err); process.exit(1); });
