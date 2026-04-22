#!/usr/bin/env node
/**
 * Seed products from catalogo.csv into the SQLite database.
 * Run: node setup/seed-products.mjs
 */
import fs from "fs";
import path from "path";
import { getDB } from "../shared/db/connection.mjs";
import { createProductRepo } from "../shared/db/products.mjs";
import { getTenantId } from "../shared/lib/config.mjs";

const dataDir = process.env.DATA_DIR || "./data";
const tenantsDir = process.env.TENANTS_DIR || "./tenants";
const csvPath = path.join(tenantsDir, getTenantId(), "catalogo.csv");

if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
}

const db = getDB(dataDir);
const products = createProductRepo(db);

const lines = fs.readFileSync(csvPath, "utf-8").trim().split("\n");
const header = lines[0].split(",").map(h => h.trim().toLowerCase());
let count = 0;

for (let i = 1; i < lines.length; i++) {
  const values = lines[i].split(",").map(v => v.trim());
  const row = {};
  header.forEach((h, j) => { row[h] = values[j] || ""; });

  const product = {
    sku: row.sku,
    name: row.nome || row.name,
    roaster: row.torrefacao || row.roaster,
    sca_score: parseInt(row.sca) || null,
    profile: row.perfil || row.profile || "",
    price: parseFloat(row.preco || row.price) || 0,
    weight: row.peso || row.weight || "250g",
    available: row.disponivel !== "0" && row.disponivel !== "false" ? 1 : 0,
    highlight: row.destaque || row.highlight || "",
  };

  if (product.sku && product.name) {
    try {
      db.prepare(`INSERT OR REPLACE INTO products (sku, name, roaster, sca_score, profile, price, weight, available, highlight, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
        .run(product.sku, product.name, product.roaster, product.sca_score, product.profile, product.price, product.weight, product.available, product.highlight);
      count++;
    } catch (err) { console.warn(`  Skip ${product.sku}: ${err.message}`); }
  }
}

console.log(`✅ Seeded ${count} products from ${csvPath}`);
