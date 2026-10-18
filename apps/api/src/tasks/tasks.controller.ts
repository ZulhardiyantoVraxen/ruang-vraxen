import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { TasksService } from "./tasks.service";
import { BroadcastCommandDto, CreateTaskDto, TriageTaskDto } from "./dto";
import { ObjectStorageService } from "../storage/object-storage.service";

@Controller("tasks")
export class TasksController {
  constructor(
    private readonly service: TasksService,
    private readonly storage: ObjectStorageService,
  ) {}

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

  /**
   * On-demand PDF of a task's result (first step of "output dokumen
   * tersimpan di Google Drive" - a real file has to exist before it can be
   * uploaded anywhere). Stored at a predictable key by the worker right
   * after the executor finishes, so no DB column is needed for it.
   *
   * MinIO has no published host port in production (internal network only,
   * by design), so the API reads the object itself and streams it back -
   * the browser only ever talks to the already-public API, never MinIO.
   */
  @Get(":id/pdf")
  async pdf(@Param("id") id: string, @Res() res: Response) {
    const key = `${id}/executor-output.pdf`;
    if (!(await this.storage.exists(key))) {
      throw new NotFoundException("PDF belum tersedia untuk task ini.");
    }
    const buffer = await this.storage.getObjectBuffer(key);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="task-${id}.pdf"`,
      "Content-Length": buffer.length,
    });
    res.send(buffer);
  }
}
