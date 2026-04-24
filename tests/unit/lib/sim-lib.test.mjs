import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, percentile, summarizeLatencies, simPhone } from "../../../scripts/sim/lib.mjs";

describe("scripts/sim/lib parseArgs", () => {
  it("parses --key value pairs and coerces numbers", () => {
    assert.deepEqual(
      parseArgs(["--messages", "100", "--label", "baseline"]),
      { messages: 100, label: "baseline" }
    );
  });

  it("treats --flag with no value as true", () => {
    assert.deepEqual(parseArgs(["--once"]), { once: true });
  });

  it("treats --flag followed by --next as boolean true", () => {
    assert.deepEqual(parseArgs(["--listen", "--phone", "55"]), { listen: true, phone: 55 });
  });

  it("ignores positional args", () => {
    assert.deepEqual(parseArgs(["hello", "--x", "1"]), { x: 1 });
  });
});

describe("scripts/sim/lib percentile", () => {
  it("handles empty input", () => {
    assert.ok(Number.isNaN(percentile([], 50)));
  });

  it("returns single value for length-1 input", () => {
    assert.equal(percentile([42], 99), 42);
  });

  it("matches linear interpolation on a sorted set", () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(percentile(data, 50), 5.5);
    assert.equal(percentile(data, 0),  1);
    assert.equal(percentile(data, 100), 10);
  });

  it("works on unsorted input", () => {
    assert.equal(percentile([9, 1, 5, 3, 7], 50), 5);
  });
});

describe("scripts/sim/lib summarizeLatencies", () => {
  it("returns count-only for empty set", () => {
    assert.deepEqual(summarizeLatencies([]), { count: 0 });
  });

  it("rounds percentile output", () => {
    const s = summarizeLatencies([100, 200, 300, 400, 500]);
    assert.equal(s.count, 5);
    assert.equal(s.min, 100);
    assert.equal(s.max, 500);
    assert.equal(s.p50, 300);
  });
});

describe("scripts/sim/lib simPhone", () => {
  it("is deterministic and distinct per index", () => {
    assert.equal(simPhone(0), "5500000090000");
    assert.equal(simPhone(1), "5500000090001");
    assert.notEqual(simPhone(0), simPhone(1));
  });
});
