import amqplib from "amqplib";

const EXCHANGES = {
  MSG_FLOW: "msg.flow",    // topic — main pipeline
  EVENTS: "events",        // topic — analytics, completion
  DLX: "dlx",             // fanout — dead letters
};

const QUEUES = [
  { name: "gateway.incoming",      exchange: "msg.flow", routingKey: "incoming" },
  { name: "aggregator.validated",  exchange: "msg.flow", routingKey: "validated" },
  { name: "aggregator.completed",  exchange: "events",   routingKey: "completed" },
  { name: "enricher.ready",        exchange: "msg.flow", routingKey: "ready" },
  { name: "agent.enriched",        exchange: "msg.flow", routingKey: "enriched" },
  { name: "sender.response",       exchange: "msg.flow", routingKey: "response" },
  { name: "sender.outgoing",       exchange: "msg.flow", routingKey: "outgoing" },
  { name: "analytics.events",      exchange: "events",   routingKey: "#" },
  { name: "whatsapp.send",         exchange: "msg.flow", routingKey: "send" },
  { name: "dead-letters",          exchange: "dlx",      routingKey: "" },
];

export async function connect(uri) {
  const connection = await amqplib.connect(uri);
  const channel = await connection.createChannel();
  return { connection, channel };
}

export function publish(channel, exchange, routingKey, envelope) {
  const buffer = Buffer.from(JSON.stringify(envelope));
  channel.publish(exchange, routingKey, buffer, { persistent: true, contentType: "application/json" });
}

export function consume(channel, queue, handler, { prefetch = 1 } = {}) {
  channel.prefetch(prefetch);
  return channel.consume(queue, handler);
}

export function ack(channel, msg) { channel.ack(msg); }
export function nack(channel, msg, requeue = false) { channel.nack(msg, false, requeue); }

export async function setupExchangesAndQueues(channel) {
  await channel.assertExchange(EXCHANGES.MSG_FLOW, "topic", { durable: true });
  await channel.assertExchange(EXCHANGES.EVENTS, "topic", { durable: true });
  await channel.assertExchange(EXCHANGES.DLX, "fanout", { durable: true });
  for (const q of QUEUES) {
    const opts = { durable: true };
    if (q.name !== "dead-letters") opts.arguments = { "x-dead-letter-exchange": "dlx" };
    await channel.assertQueue(q.name, opts);
    await channel.bindQueue(q.name, q.exchange, q.routingKey);
  }
  console.log(`✅ RabbitMQ topology: ${Object.keys(EXCHANGES).length} exchanges, ${QUEUES.length} queues`);
}

export { EXCHANGES, QUEUES };
