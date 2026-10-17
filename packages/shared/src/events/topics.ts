/**
 * Kafka topic design: one topic per AGGREGATE, not per event type.
 *
 * Why: with divisions/roles created dynamically at runtime, a topic-per-event
 * scheme (division.created, division.renamed, division.archived, ...) grows
 * without bound and every new onboarding feature means a new topic + new ACLs
 * + new consumer group wiring. Instead each aggregate gets ONE topic; the
 * specific thing that happened travels inside the payload as `eventType`.
 * Consumers subscribe to the topic and switch on eventType. Partition key is
 * always the aggregate id, so events for one division/task/agent stay in
 * order on the same partition.
 */
export const TOPICS = {
  DIVISION_EVENTS: "division-events",
  AGENT_EVENTS: "agent-events",
  TASK_EVENTS: "task-events",
  USAGE_EVENTS: "usage-events", // token/cost telemetry - highest volume topic
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

export const DIVISION_EVENT_TYPES = [
  "division.onboarding.started",
  "division.onboarding.question_asked",
  "division.onboarding.answered",
  "division.roster.recommended",
  "division.roster.confirmed",
  "division.activated",
  "division.paused",
  "division.archived",
] as const;

export const AGENT_EVENT_TYPES = [
  "agent.provisioned",
  "agent.status.changed",
  "agent.model_variant.switched", // FREE <-> PAID
] as const;

export const TASK_EVENT_TYPES = [
  "task.created",
  "task.subtask.created",
  "task.assigned",
  "task.started",
  "task.qa.requested",
  "task.qa.passed",
  "task.qa.failed",         // triggers revisionCount++ back to executor
  "task.revision_limit.reached", // stop the QA<->Spesialis loop (Catatan Penting)
  "task.approval.requested",
  "task.approved",
  "task.rejected",
  "task.completed",
] as const;

export const USAGE_EVENT_TYPES = [
  "usage.recorded",
  "usage.cost_cap.warning", // approaching CostCap.maxCostUsd
  "usage.cost_cap.exceeded",
] as const;
