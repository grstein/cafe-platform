import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { publish, setupExchangesAndQueues } from "../../../shared/lib/rabbitmq.mjs";

describe("rabbitmq", () => {
  it("publish serializes envelope as persistent JSON", () => {
    let captured = null;
    const mockCh = {
      publish(ex, rk, buf, opts) { captured = { ex, rk, buf, opts }; return true; },
    };
    publish(mockCh, "msg.flow", "incoming", { id: "1", phone: "123" });
    assert.ok(captured);
    assert.equal(captured.opts.persistent, true);
    assert.equal(captured.opts.contentType, "application/json");
    const parsed = JSON.parse(captured.buf.toString());
    assert.equal(parsed.id, "1");
  });

  it("setupExchangesAndQueues declares 3 exchanges", async () => {
    const exchanges = [];
    const queues = [];
    const bindings = [];
    const mockCh = {
      async assertExchange(n, t, o) { exchanges.push({ n, t }); },
      async assertQueue(n, o) { queues.push({ n, o }); },
      async bindQueue(q, e, r) { bindings.push({ q, e, r }); },
    };
    await setupExchangesAndQueues(mockCh);
    assert.equal(exchanges.length, 3);
    assert.ok(exchanges.find(e => e.n === "msg.flow" && e.t === "topic"));
    assert.ok(exchanges.find(e => e.n === "events" && e.t === "topic"));
    assert.ok(exchanges.find(e => e.n === "dlx" && e.t === "fanout"));
  });

  it("setupExchangesAndQueues declares 10 queues with DLX", async () => {
    const queues = [];
    const mockCh = {
      async assertExchange() {},
      async assertQueue(n, o) { queues.push({ n, o }); },
      async bindQueue() {},
    };
    await setupExchangesAndQueues(mockCh);
    assert.equal(queues.length, 10);
    const withDlx = queues.filter(q => q.o?.arguments?.["x-dead-letter-exchange"] === "dlx");
    assert.equal(withDlx.length, 9); // all except dead-letters itself
  });

  it("setupExchangesAndQueues creates correct bindings", async () => {
    const bindings = [];
    const mockCh = {
      async assertExchange() {},
      async assertQueue() {},
      async bindQueue(q, e, r) { bindings.push({ q, e, r }); },
    };
    await setupExchangesAndQueues(mockCh);
    assert.ok(bindings.find(b => b.q === "gateway.incoming" && b.r === "incoming"));
    assert.ok(bindings.find(b => b.q === "aggregator.validated" && b.r === "validated"));
    assert.ok(bindings.find(b => b.q === "analytics.events" && b.r === "#"));
  });
});
