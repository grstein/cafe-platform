/**
 * @fileoverview JSONL logging.
 *
 * Extraído do consumer monolítico — cada chamada gera uma linha JSON
 * com timestamp, tipo, phone e dados adicionais, gravada em arquivo diário.
 */

import fs from "fs";
import path from "path";

/**
 * Creates a logger that writes JSONL entries to daily files.
 *
 * @param {string} logDir - Directory for log files (created if missing).
 * @returns {{ log(type: string, phone: string, data?: Record<string, any>): void }}
 */
export function createLogger(logDir) {
  fs.mkdirSync(logDir, { recursive: true });

  /**
   * Log an event as JSONL.
   *
   * @param {string} type - Event type (MSG_IN, MSG_OUT, CMD, etc.)
   * @param {string} phone - Phone number associated with the event.
   * @param {Record<string, any>} [data] - Additional data to include.
   */
  function log(type, phone, data = {}) {
    const entry = { ts: new Date().toISOString(), type, phone, ...data };
    const line = JSON.stringify(entry);
    const preview = (data.text || data.detail || data.preview || "").substring(0, 80);
    console.log(`[${type}] ${phone} ${preview}`);
    const date = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(logDir, `${date}.jsonl`), line + "\n");
  }

  return { log };
}
