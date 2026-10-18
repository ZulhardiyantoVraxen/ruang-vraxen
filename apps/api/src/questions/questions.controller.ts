import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { QuestionsService } from "./questions.service";
import { AnswerDirectorQuestionDto, AskDirectorDto } from "./dto";

@Controller("questions")
export class QuestionsController {
  constructor(private readonly service: QuestionsService) {}

  @Get("open") open() {
    return this.service.open();
  }

  /** Called by apps/worker when a PM-tier executor needs the director's input. */
  @Post() ask(@Body() dto: AskDirectorDto) {
    return this.service.ask(dto);
  }

  @Patch(":id/answer")
  answer(@Param("id") id: string, @Body() dto: AnswerDirectorQuestionDto) {
    return this.service.answer(id, dto.answer, dto.approverRef);
  }
}
