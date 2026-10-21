import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { MeetingsService } from "./meetings.service";
import { CreateMeetingRoomDto, CreateTaskFromSummaryDto, InviteToMeetingDto, SendMeetingMessageDto } from "./dto";

@Controller("meetings")
export class MeetingsController {
  constructor(private readonly service: MeetingsService) {}

  @Get() list(@Query("status") status?: string) {
    return this.service.list(status);
  }

  /** "Satu privat Direktur+CEO" - idempotent, always resolves to the same standing room. */
  @Post("director-ceo") directorCeo() {
    return this.service.ensureDirectorCeoRoom();
  }

  /** "Satu terbuka untuk semua tim yang diundang" - ad hoc per topik. */
  @Post() create(@Body() dto: CreateMeetingRoomDto) {
    return this.service.createOpenRoom(dto.title, dto.inviteAgentIds);
  }

  @Get(":id") get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post(":id/messages") send(@Param("id") id: string, @Body() dto: SendMeetingMessageDto) {
    return this.service.sendMessage(id, dto.content, dto.attachmentIds ?? []);
  }

  @Post(":id/invite") invite(@Param("id") id: string, @Body() dto: InviteToMeetingDto) {
    return this.service.invite(id, dto.agentId);
  }

  @Post(":id/close") close(@Param("id") id: string) {
    return this.service.close(id);
  }

  /** "Dirangkum dulu dari hasil rapat" - draft title+description from the transcript so far; nothing is created yet. */
  @Post(":id/summarize") summarize(@Param("id") id: string) {
    return this.service.summarize(id);
  }

  /** "Lalu dijadikan task" - Director-approved summary becomes a real Task assigned to the chosen participant. */
  @Post(":id/create-task") createTask(@Param("id") id: string, @Body() dto: CreateTaskFromSummaryDto) {
    return this.service.createTaskFromSummary(id, dto.agentId, dto.title, dto.description);
  }
}
