/**
 * @fileoverview Mock RabbitMQ channel for unit tests.
 *
 * Simulates amqplib channel behavior, recording all publish/ack/nack
 * calls for assertions.
 */

/**
 * Create a mock RabbitMQ channel.
 *
 * @returns {object} Mock channel with recording capabilities.
 */
export function createMockChannel() {
  const published = [];
  let ackedCount = 0;
  let nackedCount = 0;
  const consumers = new Map();

  return {
    /** Recorded published messages: [{ exchange, routingKey, envelope }] */
    get published() { return published; },
    get ackedCount() { return ackedCount; },
    get nackedCount() { return nackedCount; },

    /** Clear all recorded state. */
    reset() {
      published.length = 0;
      ackedCount = 0;
      nackedCount = 0;
    },

    /** Get published messages filtered by routing key pattern. */
    getPublished(routingKeyPattern) {
      if (!routingKeyPattern) return [...published];
      return published.filter(p => p.routingKey.includes(routingKeyPattern));
    },

    /** Get the last published message. */
    getLastPublished() {
      return published[published.length - 1] || null;
    },

    // ── amqplib channel interface ──────────────────────────────

    publish(exchange, routingKey, buffer, options) {
      const envelope = JSON.parse(buffer.toString());
      published.push({ exchange, routingKey, envelope, options });
      return true;
    },

    ack(msg) {
      ackedCount++;
    },

    nack(msg, allUpTo, requeue) {
      nackedCount++;
    },

    async prefetch(count) { /* no-op */ },

    async consume(queue, handler) {
      consumers.set(queue, handler);
      return { consumerTag: `mock-${queue}` };
    },

    async assertExchange(name, type, opts) {
      return { exchange: name };
    },

    async assertQueue(name, opts) {
      return { queue: name, messageCount: 0, consumerCount: 0 };
    },

    async bindQueue(queue, exchange, routingKey) { /* no-op */ },

    async close() { /* no-op */ },

    // ── Test utilities ──────────────────────────────────────────

    /**
     * Simulate delivering a message to a consumer.
     *
     * @param {string} queue - Queue name.
     * @param {object} envelope - Message envelope.
     */
    async deliver(queue, envelope) {
      const handler = consumers.get(queue);
      if (!handler) throw new Error(`No consumer registered for queue: ${queue}`);
      const msg = {
        content: Buffer.from(JSON.stringify(envelope)),
        fields: { deliveryTag: Date.now(), redelivered: false, routingKey: "" },
        properties: {},
      };
      await handler(msg);
    },
  };
}
