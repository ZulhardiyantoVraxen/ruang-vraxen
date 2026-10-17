import { IsBoolean, IsInt, IsOptional, IsString, Min } from "class-validator";

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
