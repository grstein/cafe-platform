#!/usr/bin/env node
/**
 * Seed products from a JSON file into the PostgreSQL database.
 *
 * Usage:
 *   node setup/seed-products.mjs [path/to/products.json]
 *
 * If no path is given, looks for pi-config/products.json.
 *
 * JSON format — array of product objects:
 * [
 *   {
 *     "sku":      "DEMO-001",
 *     "name":     "Produto Exemplo",
 *     "roaster":  "Torrefação XYZ",
 *     "sca_score": 85,
 *     "profile":  "Achocolatado, encorpado",
 *     "origin":   "Cerrado Mineiro",
 *     "process":  "Natural",
 *     "price":    49.90,
 *     "weight":   "250g",
 *     "available": true,
 *     "highlight": "porta de entrada"
 *   }
 * ]
 */

import fs from "fs";
import path from "path";
import { getDB, initDB } from "../shared/db/connection.mjs";
import { createProductRepo } from "../shared/db/products.mjs";

const configDir = process.env.CONFIG_DIR || "./pi-config";
const filePath = process.argv[2] || path.join(configDir, "products.json");

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  console.error("Create a products.json file and pass its path as argument.");
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(filePath, "utf-8"));
if (!Array.isArray(rows) || rows.length === 0) {
  console.error("products.json must be a non-empty JSON array.");
  process.exit(1);
}

await initDB();
const db = getDB();
const products = createProductRepo(db);

const { inserted } = await products.upsertBatch(rows);
console.log(`✅ Seeded ${inserted} products from ${filePath}`);

await db.end();
