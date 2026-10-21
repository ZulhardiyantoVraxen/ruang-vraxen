import { Body, Controller, Param, Post } from "@nestjs/common";
import { OrchestratorService } from "./orchestrator.service";

/**
 * This is the "bertanya apa yang dibutuhkan, lalu rekomendasi divisi" flow:
 * POST /onboarding/start          { brief }                       -> first question
 * POST /onboarding/:id/answer     { answer }                      -> next question OR recommendation
 * POST /onboarding/:id/confirm    { slug, name, description }      -> creates the Division for real
 */
@Controller("onboarding")
export class OrchestratorController {
  constructor(private readonly service: OrchestratorService) {}

  @Post("start") start(@Body() body: { brief: string; attachmentIds?: string[] }) {
    return this.service.start(body.brief, body.attachmentIds ?? []);
  }

  @Post(":id/answer") answer(@Param("id") id: string, @Body() body: { answer: string; attachmentIds?: string[] }) {
    return this.service.answer(id, body.answer, body.attachmentIds ?? []);
  }

  @Post(":id/confirm")
  confirm(@Param("id") id: string, @Body() body: { slug: string; name: string; description?: string }) {
    return this.service.confirm(id, body.slug, body.name, body.description);
  }
}
