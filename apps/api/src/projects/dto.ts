import { IsArray, IsOptional, IsString } from "class-validator";

export class CreateProjectDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  /** Ids returned by POST /uploads (one per file - a folder upload is just several). */
  @IsOptional() @IsArray() @IsString({ each: true }) attachmentIds?: string[];
}
