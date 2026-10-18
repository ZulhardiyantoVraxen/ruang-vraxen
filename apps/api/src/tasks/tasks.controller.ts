import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { BroadcastCommandDto, CreateTaskDto, TriageTaskDto } from "./dto";

@Controller("tasks")
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Post() create(@Body() dto: CreateTaskDto) {
    return this.service.create(dto);
  }

  /** "Perintah sekaligus" from the office view - one instruction, several agents at once. */
  @Post("broadcast") broadcast(@Body() dto: BroadcastCommandDto) {
    return this.service.broadcast(dto);
  }

  /** Auditor's daily chase - called once a day by the VPS's own crontab (see infra/). */
  @Post("audit/daily-check-in") auditDailyCheckIn() {
    return this.service.auditDailyCheckIn();
  }

  /** "Semua personel harus interaktif" - idle-agent escalation chain, called periodically by the VPS's own crontab (see infra/). */
  @Post("audit/idle-check-in") idleCheckIn() {
    return this.service.checkIdleAgents();
  }

  @Get("division/:divisionId/running") running(@Param("divisionId") divisionId: string) {
    return this.service.runningByDivision(divisionId);
  }

  @Post(":id/assign") assign(@Param("id") id: string, @Body() body: { agentId: string; role: "EXECUTOR" | "REVIEWER" }) {
    return this.service.assign(id, body.agentId, body.role);
  }

  /** Called by apps/worker once Chief of Staff's AI call decides where a task actually belongs. */
  @Post(":id/triage") triage(@Param("id") id: string, @Body() dto: TriageTaskDto) {
    return this.service.triage(id, dto);
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
