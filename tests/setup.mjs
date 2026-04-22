/**
 * Global test setup. Runs before any test module is imported.
 *
 * Sets environment variables that platform code requires at import time
 * (e.g. TENANT_ID is read by getTenantId() the first time an envelope or
 * DB connection is created; ORDER_PREFIX and REFERRAL_CODE_PREFIX are read
 * when formatting order/referral identifiers).
 *
 * Used via: node --test --import=./tests/setup.mjs ...
 * or via the `test` npm script.
 */

process.env.TENANT_ID = process.env.TENANT_ID || "test-tenant";
process.env.ORDER_PREFIX = process.env.ORDER_PREFIX || "TEST-";
process.env.REFERRAL_CODE_PREFIX = process.env.REFERRAL_CODE_PREFIX || "TEST-";
