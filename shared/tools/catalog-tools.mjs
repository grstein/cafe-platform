/**
 * @fileoverview Catalog search tool for the Pi Agent.
 *
 * Replaces the agent's need to `read catalogo.csv` with a structured
 * search that returns only matching products — saving tokens and
 * enabling filter-by-profile, price range, etc.
 */

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

/**
 * Creates the search_catalog tool bound to the product repo.
 *
 * @param {{ products: ReturnType<typeof import('../db/products.mjs').createProductRepo> }} repos
 * @returns {Array} Array with one defineTool result.
 */
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
      "Use search_catalog em vez de ler catalogo.csv — é mais rápido e preciso.",
      "Sempre consulte search_catalog antes de recomendar cafés ou criar pedidos.",
      "Para ver todos os cafés disponíveis, chame sem parâmetros.",
      "Use o campo knowledge_file para saber qual ficha detalha cada café.",
    ],
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({ description: "Busca por nome, perfil sensorial, torrefação ou origem (ex: 'achocolatado', 'Moka', 'Mantiqueira')" })
      ),
      max_price: Type.Optional(
        Type.Number({ description: "Preço máximo em reais" })
      ),
      min_sca: Type.Optional(
        Type.Number({ description: "Nota SCA mínima (ex: 85)" })
      ),
      roaster: Type.Optional(
        Type.String({ description: "Nome exato da torrefação" })
      ),
      include_unavailable: Type.Optional(
        Type.Boolean({ description: "Incluir cafés indisponíveis (padrão: false)" })
      ),
    }),

    async execute(_toolCallId, params) {
      const results = repos.products.search({
        query: params.query,
        available: params.include_unavailable ? undefined : true,
        maxPrice: params.max_price,
        minSca: params.min_sca,
        roaster: params.roaster,
      });

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "Nenhum café encontrado com esses critérios." }],
          details: { count: 0 },
        };
      }

      const lines = results.map(p => {
        const parts = [
          `SKU: ${p.sku}`,
          `Nome: ${p.name}`,
          `Torrefação: ${p.roaster}`,
          `SCA: ${p.sca_score || 'N/A'}`,
          `Perfil: ${p.profile || 'N/A'}`,
          `Preço: R$ ${p.price.toFixed(2)}`,
          `Peso: ${p.weight}`,
          `Disponível: ${p.available ? 'sim' : 'não'}`,
        ];
        if (p.origin) parts.push(`Origem: ${p.origin}`);
        if (p.process) parts.push(`Processo: ${p.process}`);
        if (p.highlight) parts.push(`Destaque: ${p.highlight}`);
        if (p.stock > 0) parts.push(`Estoque: ${p.stock}`);
        if (p.knowledge_file) parts.push(`Ficha: ${p.knowledge_file}`);
        return parts.join(' | ');
      });

      const summary = [
        `${results.length} café(s) encontrado(s):`,
        '',
        ...lines,
      ].join('\n');

      return {
        content: [{ type: "text", text: summary }],
        details: { count: results.length, skus: results.map(p => p.sku) },
      };
    },
  });

  return [searchCatalog];
}
