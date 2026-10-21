import { IsArray, IsOptional, IsString, MinLength } from "class-validator";

export class SendChatMessageDto {
  @IsString() @MinLength(1) message!: string;
  /** Ids returned by POST /uploads - "di semua menu chat ada file upload, bisa dokumen atau folder". */
  @IsOptional() @IsArray() @IsString({ each: true }) attachmentIds?: string[];
}
