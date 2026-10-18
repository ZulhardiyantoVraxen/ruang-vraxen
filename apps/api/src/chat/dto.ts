import { IsOptional, IsString, MinLength } from "class-validator";

export class SendChatMessageDto {
  @IsString() @MinLength(1) message!: string;
  /** Id returned by POST /uploads - "di semua menu chat ada file upload". */
  @IsOptional() @IsString() attachmentId?: string;
}
