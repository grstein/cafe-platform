import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDB, createTestRepos, seedCustomer } from "../../helpers/db.mjs";
import { PHONES } from "../../helpers/fixtures.mjs";
import { createCustomerTools } from "../../../shared/tools/customer-tools.mjs";

describe("customer tools", () => {
  let sql, repos, tools;
  const phone = PHONES.primary;

  before(async () => {
    sql = await createTestDB();
    repos = createTestRepos(sql);
    await seedCustomer(sql, { phone });
    tools = createCustomerTools(phone, repos);
  });

  after(async () => { await sql.end(); });

  const saveTool = () => tools[0];

  it("saves customer name", async () => {
    const r = await saveTool().execute("c1", { name: "Alice Demo" });
    assert.ok(r.details.updated);
    const c = await repos.customers.getByPhone(phone);
    assert.equal(c.name, "Alice Demo");
  });

  it("saves CEP", async () => {
    await saveTool().execute("c1", { cep: "80250-104" });
    const c = await repos.customers.getByPhone(phone);
    assert.equal(c.cep, "80250-104");
  });

  it("saves and merges preferences", async () => {
    await saveTool().execute("c1", { preferences: { perfil: "achocolatado" } });
    await saveTool().execute("c1", { preferences: { metodo: "V60" } });
    const c = await repos.customers.getByPhone(phone);
    const prefs = JSON.parse(c.preferences);
    assert.equal(prefs.perfil, "achocolatado");
    assert.equal(prefs.metodo, "V60");
  });

  it("no fields returns no update message", async () => {
    const r = await saveTool().execute("c1", {});
    assert.ok(r.content[0].text.includes("Nenhum"));
  });
});
