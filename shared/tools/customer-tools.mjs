/**
 * @fileoverview Customer info tool for the Pi Agent — async repos.
 */

import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export function createCustomerTools(phone, repos) {
  const saveCustomerInfo = defineTool({
    name: "save_customer_info",
    label: "Salvar Info do Cliente",
    description:
      "Salva dados do cliente no cadastro (nome, CEP, preferências). " +
      "Use quando o cliente informar dados pessoais durante a conversa.",
    promptSnippet: "Salva nome, CEP, preferências e dados do cliente",
    promptGuidelines: [
      "Use quando o cliente informar nome completo, CEP, preferência de café, método de preparo ou intensidade.",
      "Não use para dados temporários.",
      "Após salvar, NÃO confirme ao cliente — use naturalmente na próxima interação.",
    ],
    parameters: Type.Object({
      name:  Type.Optional(Type.String({ description: "Nome completo do cliente" })),
      cep:   Type.Optional(Type.String({ description: "CEP de entrega" })),
      email: Type.Optional(Type.String({ description: "E-mail do cliente" })),
      city:  Type.Optional(Type.String({ description: "Cidade" })),
      state: Type.Optional(Type.String({ description: "Estado (ex: PR, SC, RS)" })),
      preferences: Type.Optional(Type.Object({
        perfil:      Type.Optional(Type.String({ description: "Perfil sensorial preferido" })),
        metodo:      Type.Optional(Type.String({ description: "Método de preparo preferido" })),
        moagem:      Type.Optional(Type.String({ description: "Preferência de moagem" })),
        intensidade: Type.Optional(Type.String({ description: "Intensidade preferida" })),
      }, { description: "Preferências de café do cliente" })),
    }),

    async execute(_toolCallId, params) {
      const directFields = {};
      if (params.name)  directFields.name  = params.name;
      if (params.cep)   directFields.cep   = params.cep;
      if (params.email) directFields.email = params.email;
      if (params.city)  directFields.city  = params.city;
      if (params.state) directFields.state = params.state;

      if (params.preferences) {
        const customer = await repos.customers.getByPhone(phone);
        let existing = {};
        try { existing = JSON.parse(customer?.preferences || "{}"); } catch {}
        const merged = { ...existing };
        const p = params.preferences;
        if (p.perfil)      merged.perfil      = p.perfil;
        if (p.metodo)      merged.metodo      = p.metodo;
        if (p.moagem)      merged.moagem      = p.moagem;
        if (p.intensidade) merged.intensidade = p.intensidade;
        directFields.preferences = JSON.stringify(merged);
      }

      await repos.customers.updateInfo(phone, directFields);

      const saved = [];
      if (params.name)  saved.push(`nome: ${params.name}`);
      if (params.cep)   saved.push(`CEP: ${params.cep}`);
      if (params.email) saved.push(`email: ${params.email}`);
      if (params.city)  saved.push(`cidade: ${params.city}`);
      if (params.state) saved.push(`estado: ${params.state}`);
      if (params.preferences) {
        const prefs = [];
        const p = params.preferences;
        if (p.perfil)      prefs.push(`perfil=${p.perfil}`);
        if (p.metodo)      prefs.push(`método=${p.metodo}`);
        if (p.moagem)      prefs.push(`moagem=${p.moagem}`);
        if (p.intensidade) prefs.push(`intensidade=${p.intensidade}`);
        if (prefs.length)  saved.push(`preferências: ${prefs.join(", ")}`);
      }

      const summary = saved.length > 0
        ? `Dados salvos para ${phone}: ${saved.join("; ")}`
        : "Nenhum campo novo para salvar.";

      return { content: [{ type: "text", text: summary }], details: { phone, updated: saved.length > 0, fields: saved } };
    },
  });

  return [saveCustomerInfo];
}
