import { Body, Controller, Get, Param, Post } from "@nestjs/common";
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
}
