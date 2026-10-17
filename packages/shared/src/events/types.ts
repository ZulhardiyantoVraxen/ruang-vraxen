import type {
  DIVISION_EVENT_TYPES,
  AGENT_EVENT_TYPES,
  TASK_EVENT_TYPES,
  USAGE_EVENT_TYPES,
} from "./topics";

export interface PlatformEvent<TType extends string = string, TPayload = unknown> {
  eventType: TType;
  aggregateId: string; // divisionId / agentId / taskId - also the Kafka partition key
  occurredAt: string; // ISO timestamp
  payload: TPayload;
}

export type DivisionEventType = (typeof DIVISION_EVENT_TYPES)[number];
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];
export type UsageEventType = (typeof USAGE_EVENT_TYPES)[number];

export interface RosterProposal {
  roleName: string;
  tier: "ATAS" | "AHLI" | "RUTIN";
  responsibilities: string;
  requiresApproval: boolean;
  maxConcurrentTasks: number;
}
