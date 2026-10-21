import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ChatService } from "./chat.service";
import { SendChatMessageDto } from "./dto";

@Controller("agents/:agentId/chat")
export class ChatController {
  constructor(private readonly service: ChatService) {}

  @Get() history(@Param("agentId") agentId: string) {
    return this.service.history(agentId);
  }

  @Post() send(@Param("agentId") agentId: string, @Body() dto: SendChatMessageDto) {
    return this.service.send(agentId, dto.message, dto.attachmentIds ?? []);
  }
}
