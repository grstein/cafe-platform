/**
 * @fileoverview Catalog tools for the Pi Agent — search + per-product detail.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export function createCatalogTools(repos) {
  const configDir = path.resolve(process.env.CONFIG_DIR || "/config/pi");

  const searchCatalog = defineTool({
    name: "search_catalog",
    label: "Buscar Catálogo",
    description:
      "Busca produtos no catálogo. " +
      "Retorna produtos com SKU, preço, perfil sensorial e disponibilidade. " +
      "Use para recomendar, comparar ou verificar informações antes de criar pedidos.",
    promptSnippet: "Busca cafés por nome, perfil, torrefação, preço ou nota SCA",
    promptGuidelines: [
      "Sempre consulte search_catalog antes de recomendar cafés ou criar pedidos.",
      "Para ver todos os cafés disponíveis, chame sem parâmetros.",
      "Para detalhes de um café específico (origem, produtor, história, preparo), use get_product_details.",
    ],
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Busca por nome, perfil sensorial, torrefação ou origem" })),
      max_price: Type.Optional(Type.Number({ description: "Preço máximo em reais" })),
      min_sca: Type.Optional(Type.Number({ description: "Nota SCA mínima (ex: 85)" })),
      available_only: Type.Optional(Type.Boolean({ description: "Somente disponíveis (padrão: true)" })),
    }),

    async execute(_toolCallId, params) {
      const products = await repos.products.search({
        query:     params.query,
        maxPrice:  params.max_price,
        minSca:    params.min_sca,
        available: params.available_only !== false,
      });

      if (products.length === 0) {
        return {
          content: [{ type: "text", text: "Nenhum produto encontrado para os filtros informados." }],
          details: { count: 0 },
        };
      }

      const lines = products.map(p => {
        const parts = [`SKU: ${p.sku}`, `Nome: ${p.name}`, `Preço: R$ ${Number(p.price).toFixed(2)}`];
        if (p.roaster) parts.push(`Torrefação: ${p.roaster}`);
        if (p.sca_score) parts.push(`SCA: ${p.sca_score}`);
        if (p.profile) parts.push(`Perfil: ${p.profile}`);
        if (p.origin) parts.push(`Origem: ${p.origin}`);
        if (p.process) parts.push(`Processo: ${p.process}`);
        if (p.weight) parts.push(`Peso: ${p.weight}`);
        if (p.highlight) parts.push(`Destaque: ${p.highlight}`);
        parts.push(`Disponível: ${p.available ? "sim" : "não"}`);
        return parts.join(" | ");
      });

      return {
        content: [{ type: "text", text: `${products.length} produto(s) encontrado(s):\n\n${lines.join("\n")}` }],
        details: { count: products.length, products },
      };
    },
  });

  const getProductDetails = defineTool({
    name: "get_product_details",
    label: "Ficha do Café",
    description:
      "Retorna a ficha detalhada de um café específico pelo SKU: " +
      "campos do catálogo + ficha em markdown (origem, produtor, notas sensoriais, " +
      "preparo sugerido, harmonização) quando disponível.",
    promptSnippet: "Busca a ficha detalhada de um café pelo SKU",
    promptGuidelines: [
      "Use quando o cliente pedir detalhes, história, origem, preparo ou harmonização de um café específico.",
      "Para listar ou comparar, prefira search_catalog.",
    ],
    parameters: Type.Object({
      sku: Type.String({ description: "SKU do produto" }),
    }),

    async execute(_toolCallId, params) {
      const product = await repos.products.getBySku(params.sku);
      if (!product) {
        return {
          content: [{ type: "text", text: `Produto não encontrado: ${params.sku}` }],
          details: { found: false },
        };
      }

      const baseParts = [
        `SKU: ${product.sku}`,
        `Nome: ${product.name}`,
        `Preço: R$ ${Number(product.price).toFixed(2)}`,
      ];
      if (product.roaster) baseParts.push(`Torrefação: ${product.roaster}`);
      if (product.sca_score) baseParts.push(`SCA: ${product.sca_score}`);
      if (product.profile) baseParts.push(`Perfil: ${product.profile}`);
      if (product.origin) baseParts.push(`Origem: ${product.origin}`);
      if (product.process) baseParts.push(`Processo: ${product.process}`);
      if (product.weight) baseParts.push(`Peso: ${product.weight}`);
      if (product.highlight) baseParts.push(`Destaque: ${product.highlight}`);
      baseParts.push(`Disponível: ${product.available ? "sim" : "não"}`);

      let markdown = null;
      let knowledgeStatus = "none";

      if (product.knowledge_file) {
        const resolved = path.resolve(configDir, product.knowledge_file);
        if (!resolved.startsWith(configDir + path.sep) && resolved !== configDir) {
          knowledgeStatus = "blocked";
        } else {
          try {
            markdown = await fs.readFile(resolved, "utf-8");
            knowledgeStatus = "ok";
          } catch {
            knowledgeStatus = "missing";
          }
        }
      }

      const sections = [baseParts.join(" | ")];
      if (markdown) {
        sections.push("\n--- FICHA DETALHADA ---\n" + markdown.trim());
      } else if (knowledgeStatus === "missing") {
        sections.push("\n(Ficha detalhada referenciada mas arquivo não encontrado.)");
      } else if (knowledgeStatus === "blocked") {
        sections.push("\n(Caminho de ficha inválido — ignorado.)");
      }

      return {
        content: [{ type: "text", text: sections.join("\n") }],
        details: { found: true, product, knowledgeStatus },
      };
    },
  });

  return [searchCatalog, getProductDetails];
}
