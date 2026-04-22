/**
 * Global test setup. Loaded via: node --test --import=./tests/setup.mjs
 *
 * Sets environment variables required before any module is imported.
 */

process.env.ORDER_PREFIX           = process.env.ORDER_PREFIX           || "TEST-";
process.env.REFERRAL_CODE_PREFIX   = process.env.REFERRAL_CODE_PREFIX   || "TEST-";
process.env.DATABASE_URL           = process.env.DATABASE_URL           || "postgresql://cafe_test:test@localhost:5432/cafe_test";
process.env.CONFIG_DIR             = process.env.CONFIG_DIR             || "/tmp/pi-config-test";
