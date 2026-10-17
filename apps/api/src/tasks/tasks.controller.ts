import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { CreateTaskDto } from "./dto";

@Controller("tasks")
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Post() create(@Body() dto: CreateTaskDto) {
    return this.service.create(dto);
  }

  @Get("division/:divisionId/running") running(@Param("divisionId") divisionId: string) {
    return this.service.runningByDivision(divisionId);
  }

  @Post(":id/assign") assign(@Param("id") id: string, @Body() body: { agentId: string; role: "EXECUTOR" | "REVIEWER" }) {
    return this.service.assign(id, body.agentId, body.role);
  }

  @Post(":id/qa-failed") qaFailed(@Param("id") id: string) {
    return this.service.qaFailed(id);
  }

  @Post(":id/qa-passed") qaPassed(@Param("id") id: string) {
    return this.service.qaPassed(id);
  }

  /** Called by apps/worker once an executor agent finishes a task. */
  @Patch(":id/result")
  recordResult(@Param("id") id: string, @Body() body: { resultSummary: string; resultObjectKey?: string }) {
    return this.service.recordResult(id, body.resultSummary, body.resultObjectKey);
  }
}
