import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateTaskDto {
  @IsString() divisionSlug!: string;
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() parentTaskId?: string; // set => this is a parallel subtask
  @IsOptional() @IsInt() @Min(1) priority?: number;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @IsOptional() @IsString() projectId?: string; // group this task under a director-visible Project
  @IsOptional() @IsDateString() dueAt?: string; // deadline shown on the Task Board card
  /** Id returned by POST /uploads - appended to the task description before dispatch. */
  @IsOptional() @IsString() attachmentId?: string;
}

/** Chief of Staff's own routing decision - which division/agent actually gets the task. */
export class TriageTaskDto {
  @IsString() divisionSlug!: string;
  @IsString() agentId!: string;
  @IsOptional() @IsString() reasoning?: string;
  /**
   * Set when auto-triage itself failed and Chief of Staff is executing the
   * directive directly instead. Every task that reaches triage originated
   * from the director's own "PIC Chief of Staff" inbox, so a failure to
   * classify it is never a reason to make the director wait on a second
   * approval loop on top of their own order - this drops Task.requiresApproval
   * regardless of what was checked when the order was sent.
   */
  @IsOptional() @IsBoolean() forceFinal?: boolean;
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
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsDateString() dueAt?: string;
  /** Id returned by POST /uploads - appended to the instruction before dispatch. */
  @IsOptional() @IsString() attachmentId?: string;
}
