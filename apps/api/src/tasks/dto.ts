import { IsBoolean, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateTaskDto {
  @IsString() divisionSlug!: string;
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() parentTaskId?: string; // set => this is a parallel subtask
  @IsOptional() @IsInt() @Min(1) priority?: number;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
}
