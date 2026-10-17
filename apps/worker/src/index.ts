import { Kafka } from "kafkajs";
import { config } from "./config";
import { TOPICS, PlatformEvent } from "@platform/shared";
import { handleTaskAssigned, TaskAssignedPayload } from "./handlers/task-assigned";
import { handleTaskCreated, TaskCreatedPayload } from "./handlers/task-created";

const kafka = new Kafka({ clientId: "platform-worker", brokers: config.kafkaBrokers });
const consumer = kafka.consumer({ groupId: "platform-worker" });

async function main() {
  await consumer.connect();
  // Only TASK_EVENTS for now - this is the executor. A future worker (or
  // this one, extended) can subscribe to DIVISION_EVENTS / AGENT_EVENTS the
  // same way: one consumer group per concern, so each can scale separately.
  await consumer.subscribe({ topic: TOPICS.TASK_EVENTS, fromBeginning: false });

  console.log(`[worker] listening on ${TOPICS.TASK_EVENTS} (brokers: ${config.kafkaBrokers.join(",")})`);

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      const event = JSON.parse(message.value.toString()) as PlatformEvent<string, unknown>;

      try {
        switch (event.eventType) {
          case "task.created":
            await handleTaskCreated(event.aggregateId, event.payload as TaskCreatedPayload);
            break;
          case "task.assigned":
            await handleTaskAssigned(event.aggregateId, event.payload as TaskAssignedPayload);
            break;
          // task.qa.* / task.approval.* / task.completed / task.triaged are
          // informational here - nothing in the worker needs to react to
          // its own downstream events.
          default:
            break;
        }
      } catch (err) {
        // Intentionally does not crash the consumer loop - one bad task
        // should not stop the rest of the division from working. A real
        // deployment should push this to a dead-letter topic instead of
        // just logging.
        console.error(`[worker] failed handling ${event.eventType} for ${event.aggregateId}:`, err);
      }
    },
  });
}

main().catch((err) => {
  console.error("[worker] fatal error", err);
  process.exit(1);
});
