/**
 * @fileoverview Catalog search tool for the Pi Agent — async repos.
 */

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export function createCatalogTools(repos) {
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

  return [searchCatalog];
}
