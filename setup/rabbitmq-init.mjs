#!/usr/bin/env node
/**
 * @fileoverview Create RabbitMQ exchanges, queues, and bindings.
 * Run: RABBITMQ_URI=amqp://... node setup/rabbitmq-init.mjs
 */
import { connect, setupExchangesAndQueues } from "../shared/lib/rabbitmq.mjs";

const uri = process.env.RABBITMQ_URI || "amqp://evolution:password@localhost:5672/evolution";

async function main() {
  console.log("🔧 Setting up RabbitMQ topology...");
  console.log(`   URI: ${uri.replace(/:[^:@]+@/, ":***@")}`);
  const { connection, channel } = await connect(uri);
  await setupExchangesAndQueues(channel);
  await channel.close();
  await connection.close();
  console.log("✅ RabbitMQ topology ready.");
}

main().catch(err => { console.error("❌ Setup failed:", err.message); process.exit(1); });
