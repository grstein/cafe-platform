import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

describe("config", () => {
  let tmpDir;
  let origTenantsDir;
  let origTenantId;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
    origTenantsDir = process.env.TENANTS_DIR;
    origTenantId = process.env.TENANT_ID;
    process.env.TENANTS_DIR = tmpDir;
    process.env.TENANT_ID = "test-tenant";
  });

  afterEach(async () => {
    if (origTenantsDir === undefined) delete process.env.TENANTS_DIR;
    else process.env.TENANTS_DIR = origTenantsDir;
    if (origTenantId === undefined) delete process.env.TENANT_ID;
    else process.env.TENANT_ID = origTenantId;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const { clearConfig } = await import("../../../shared/lib/config.mjs");
    clearConfig();
  });

  it("returns defaults when no tenant.json exists", async () => {
    const { getConfig, clearConfig } = await import("../../../shared/lib/config.mjs");
    clearConfig();
    const cfg = getConfig();
    assert.equal(cfg.session.ttl_minutes, 30);
    assert.equal(cfg.tenant_id, "test-tenant");
  });

  it("merges tenant.json over defaults", async () => {
    const dir = path.join(tmpDir, "test-tenant");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "tenant.json"), JSON.stringify({ llm: { thinking: "low" } }));
    const { getConfig, clearConfig } = await import("../../../shared/lib/config.mjs");
    clearConfig();
    const cfg = getConfig();
    assert.equal(cfg.llm.thinking, "low");
    assert.equal(cfg.llm.provider, "openrouter"); // default preserved
  });

  it("caches result on repeated calls", async () => {
    const { getConfig, clearConfig } = await import("../../../shared/lib/config.mjs");
    clearConfig();
    const a = getConfig();
    const b = getConfig();
    assert.equal(a, b);
  });

  it("clearConfig invalidates cache", async () => {
    const dir = path.join(tmpDir, "test-tenant");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "tenant.json"), JSON.stringify({ display_name: "v1" }));
    const { getConfig, clearConfig } = await import("../../../shared/lib/config.mjs");
    clearConfig();
    const a = getConfig();
    assert.equal(a.display_name, "v1");
    clearConfig();
    fs.writeFileSync(path.join(dir, "tenant.json"), JSON.stringify({ display_name: "v2" }));
    const b = getConfig();
    assert.equal(b.display_name, "v2");
  });

  it("sets _paths correctly", async () => {
    const { getConfig, clearConfig } = await import("../../../shared/lib/config.mjs");
    clearConfig();
    const cfg = getConfig();
    assert.equal(cfg._paths.allowlist, path.join(tmpDir, "test-tenant", "allowlist.txt"));
    assert.equal(cfg._paths.catalog, path.join(tmpDir, "test-tenant", "catalogo.csv"));
  });

  it("getTenantId throws when TENANT_ID is unset", async () => {
    const saved = process.env.TENANT_ID;
    delete process.env.TENANT_ID;
    try {
      const { getTenantId } = await import("../../../shared/lib/config.mjs");
      assert.throws(() => getTenantId(), /TENANT_ID/);
    } finally {
      process.env.TENANT_ID = saved;
    }
  });
});
