import { Kafka } from "kafkajs";
import { config } from "./config";
import { TOPICS, PlatformEvent } from "@platform/shared";
import { handleTaskAssigned, TaskAssignedPayload } from "./handlers/task-assigned";
import { handleTaskCreated, TaskCreatedPayload } from "./handlers/task-created";
import { apiClient } from "./api-client";

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

        // Without this, an unhandled error partway through handleTaskAssigned
        // (e.g. OpenRouter rejecting a free model slug, a model timing out)
        // leaves the task RUNNING and the agent's concurrency slot occupied
        // forever - apiClient.failTask is what actually frees the slot AND
        // drains anything queued behind it (see TasksService.failTask); the
        // agent IDLE reset alongside it is just the display status, since
        // the next drained task (if any) immediately flips it back to
        // WORKING anyway. Best-effort: if even this fails, the task/agent
        // stay stuck and need a manual nudge, but the rest of the division
        // keeps running.
        if (event.eventType === "task.assigned") {
          const agentId = (event.payload as TaskAssignedPayload | undefined)?.agentId;
          const reason = err instanceof Error ? err.message : String(err);
          await apiClient.failTask(event.aggregateId, reason).catch((failErr) => {
            console.error(`[worker] also failed to mark task ${event.aggregateId} FAILED after the error above:`, failErr);
          });
          if (agentId) {
            await apiClient.setAgentStatus(agentId, "IDLE").catch((resetErr) => {
              console.error(`[worker] also failed to reset agent ${agentId} to IDLE after the error above:`, resetErr);
            });
          }
        }
      }
    },
  });
}

main().catch((err) => {
  console.error("[worker] fatal error", err);
  process.exit(1);
});
