/**
 * @fileoverview Customer info tool for the Pi Agent — this platform v6.
 *
 * Allows the agent to persist customer data (name, CEP, preferences)
 * so that future conversations start with full context.
 */

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

/**
 * Creates the save_customer_info tool bound to a specific phone and repos.
 *
 * @param {string} phone - Customer phone number.
 * @param {{ customers: ReturnType<typeof import('../db/customers.mjs').createCustomerRepo> }} repos
 * @returns {Array} Array with one defineTool result.
 */
export function createCustomerTools(phone, repos) {
  const saveCustomerInfo = defineTool({
    name: "save_customer_info",
    label: "Salvar Info do Cliente",
    description:
      "Salva dados do cliente no cadastro (nome, CEP, preferências). " +
      "Use quando o cliente informar dados pessoais durante a conversa " +
      "que devem ser lembrados para futuras interações.",
    promptSnippet: "Salva nome, CEP, preferências e dados do cliente",
    promptGuidelines: [
      "Use save_customer_info quando o cliente informar nome completo, CEP, preferência de café, método de preparo ou intensidade.",
      "Não use para dados temporários — apenas informações que o cliente quer que sejam lembradas.",
      "Após salvar, NÃO confirme ao cliente que salvou dados — use naturalmente na próxima interação.",
    ],
    parameters: Type.Object({
      name: Type.Optional(
        Type.String({ description: "Nome completo do cliente" })
      ),
      cep: Type.Optional(
        Type.String({ description: "CEP de entrega" })
      ),
      email: Type.Optional(
        Type.String({ description: "E-mail do cliente" })
      ),
      city: Type.Optional(
        Type.String({ description: "Cidade" })
      ),
      state: Type.Optional(
        Type.String({ description: "Estado (ex: PR, SC, RS)" })
      ),
      preferences: Type.Optional(
        Type.Object(
          {
            perfil: Type.Optional(
              Type.String({ description: "Perfil sensorial preferido (ex: achocolatado, frutado)" })
            ),
            metodo: Type.Optional(
              Type.String({ description: "Método de preparo preferido (ex: prensa francesa, V60, espresso)" })
            ),
            moagem: Type.Optional(
              Type.String({ description: "Preferência de moagem (ex: grossa, média, fina)" })
            ),
            intensidade: Type.Optional(
              Type.String({ description: "Intensidade preferida (ex: suave, médio, intenso)" })
            ),
          },
          { description: "Preferências de café do cliente" }
        )
      ),
    }),

    async execute(_toolCallId, params) {
      // Separate direct fields from preferences
      const directFields = {};
      if (params.name) directFields.name = params.name;
      if (params.cep) directFields.cep = params.cep;
      if (params.email) directFields.email = params.email;
      if (params.city) directFields.city = params.city;
      if (params.state) directFields.state = params.state;

      // Merge preferences with existing ones
      if (params.preferences) {
        const customer = repos.customers.getByPhone(phone);
        let existing = {};
        if (customer?.preferences) {
          try {
            existing = JSON.parse(customer.preferences);
          } catch { /* start fresh */ }
        }
        const merged = { ...existing };
        if (params.preferences.perfil) merged.perfil = params.preferences.perfil;
        if (params.preferences.metodo) merged.metodo = params.preferences.metodo;
        if (params.preferences.moagem) merged.moagem = params.preferences.moagem;
        if (params.preferences.intensidade) merged.intensidade = params.preferences.intensidade;
        directFields.preferences = JSON.stringify(merged);
      }

      // Apply update
      const updated = repos.customers.updateInfo(phone, directFields);

      // Build confirmation for the agent (not shown to the customer)
      const saved = [];
      if (params.name) saved.push(`nome: ${params.name}`);
      if (params.cep) saved.push(`CEP: ${params.cep}`);
      if (params.email) saved.push(`email: ${params.email}`);
      if (params.city) saved.push(`cidade: ${params.city}`);
      if (params.state) saved.push(`estado: ${params.state}`);
      if (params.preferences) {
        const p = params.preferences;
        const prefs = [];
        if (p.perfil) prefs.push(`perfil=${p.perfil}`);
        if (p.metodo) prefs.push(`método=${p.metodo}`);
        if (p.moagem) prefs.push(`moagem=${p.moagem}`);
        if (p.intensidade) prefs.push(`intensidade=${p.intensidade}`);
        if (prefs.length) saved.push(`preferências: ${prefs.join(', ')}`);
      }

      const summary = saved.length > 0
        ? `Dados salvos para ${phone}: ${saved.join('; ')}`
        : 'Nenhum campo novo para salvar.';

      return {
        content: [{ type: "text", text: summary }],
        details: { phone, updated: saved.length > 0, fields: saved },
      };
    },
  });

  return [saveCustomerInfo];
}
