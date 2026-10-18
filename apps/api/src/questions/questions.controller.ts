import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { QuestionsService } from "./questions.service";
import { AnswerDirectorQuestionDto, AskDirectorDto, ConfirmRepoDto, RequestGithubRepoDto } from "./dto";

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

  /** Called by apps/worker when a PM needs the director to create a named GitHub repo before it starts development. */
  @Post("repo-request") requestRepo(@Body() dto: RequestGithubRepoDto) {
    return this.service.requestRepo(dto);
  }

  @Patch(":id/confirm-repo")
  confirmRepo(@Param("id") id: string, @Body() dto: ConfirmRepoDto) {
    return this.service.confirmRepo(id, dto.repoName);
  }

  @Patch(":id/answer")
  answer(@Param("id") id: string, @Body() dto: AnswerDirectorQuestionDto) {
    return this.service.answer(id, dto.answer, dto.approverRef);
  }
}
