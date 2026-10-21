import { ArrayMinSize, IsArray, IsOptional, IsString, MinLength } from "class-validator";

export class CreateMeetingRoomDto {
  @IsString() @MinLength(1) title!: string;
  /** Agent ids to invite - the OPEN room's whole roster for this topic. */
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) inviteAgentIds!: string[];
}

export class SendMeetingMessageDto {
  @IsString() @MinLength(1) content!: string;
}

export class InviteToMeetingDto {
  @IsString() @MinLength(1) agentId!: string;
}

export class ListMeetingRoomsDto {
  @IsOptional() @IsString() status?: string;
}
