import { ArrayMinSize, IsArray, IsOptional, IsString, MinLength } from "class-validator";

export class CreateMeetingRoomDto {
  @IsString() @MinLength(1) title!: string;
  /** Agent ids to invite - the OPEN room's whole roster for this topic. */
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) inviteAgentIds!: string[];
}

export class SendMeetingMessageDto {
  @IsString() @MinLength(1) content!: string;
  /** Ids returned by POST /uploads (one per file - a folder upload is just several). */
  @IsOptional() @IsArray() @IsString({ each: true }) attachmentIds?: string[];
}

export class InviteToMeetingDto {
  @IsString() @MinLength(1) agentId!: string;
}

export class ListMeetingRoomsDto {
  @IsOptional() @IsString() status?: string;
}

export class CreateTaskFromSummaryDto {
  @IsString() @MinLength(1) agentId!: string;
  @IsString() @MinLength(1) title!: string;
  @IsString() @MinLength(1) description!: string;
}
