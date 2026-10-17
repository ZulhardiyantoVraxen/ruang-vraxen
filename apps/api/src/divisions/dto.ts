import { IsBoolean, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateDivisionDto {
  @IsString() slug!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
}

export class CreateAgentRoleDto {
  @IsString() name!: string;
  @IsString() tier!: "ATAS" | "AHLI" | "RUTIN";
  @IsOptional() @IsString() responsibilities?: string;
  @IsOptional() @IsInt() @Min(1) maxConcurrentTasks?: number;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
}
