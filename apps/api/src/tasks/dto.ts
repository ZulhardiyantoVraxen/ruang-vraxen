import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateTaskDto {
  @IsString() divisionSlug!: string;
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() parentTaskId?: string; // set => this is a parallel subtask
  @IsOptional() @IsInt() @Min(1) priority?: number;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
}

/** Chief of Staff's own routing decision - which division/agent actually gets the task. */
export class TriageTaskDto {
  @IsString() divisionSlug!: string;
  @IsString() agentId!: string;
  @IsOptional() @IsString() reasoning?: string;
}

/**
 * One free-text instruction, fanned out to any number of agents at once
 * (one Task each, same wording) - "perintah sekaligus ke 1, 2, atau semua
 * agent yang dipilih" from the office view. Each target agent is already
 * known, so this skips Chief of Staff's pusat-inbox triage entirely and
 * goes straight into the normal executor pipeline (task.assigned).
 */
export class BroadcastCommandDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) agentIds!: string[];
  @IsString() instruction!: string;
}
