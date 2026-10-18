import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { TasksService } from "./tasks.service";
import { BroadcastCommandDto, CreateTaskDto, OverrideTaskStatusDto, TriageTaskDto } from "./dto";
import { ObjectStorageService } from "../storage/object-storage.service";
import { UploadsService } from "../uploads/uploads.service";
import { LinkReaderService } from "../common/link-reader.service";

@Controller("tasks")
export class TasksController {
  constructor(
    private readonly service: TasksService,
    private readonly storage: ObjectStorageService,
    private readonly uploads: UploadsService,
    private readonly linkReader: LinkReaderService,
  ) {}

  /**
   * Folds an attachment's content and any URLs typed into the text into one
   * block before it becomes a Task's description/instruction - "di semua
   * menu chat ada file upload" + "agent juga bisa membaca dari link yang
   * saya berikan".
   */
  private async withExtras(text: string, attachmentId?: string): Promise<string> {
    const parts = [text];
    if (attachmentId) parts.push(await this.uploads.describeForPrompt(attachmentId));
    const links = await this.linkReader.describeLinksInText(text);
    if (links) parts.push(links);
    return parts.filter(Boolean).join("\n\n");
  }

  @Post() async create(@Body() dto: CreateTaskDto) {
    const description = await this.withExtras(dto.description ?? "", dto.attachmentId);
    return this.service.create({ ...dto, description: description || undefined });
  }

  /**
   * "Kanban saya pengen bisa geser sendiri, Direktur punya hak penuh untuk
   * mempercepat progress" - drag-and-drop on the Task Board calls this to
   * force a card into whatever column the director dropped it on.
   */
  @Patch(":id/status") overrideStatus(@Param("id") id: string, @Body() dto: OverrideTaskStatusDto) {
    return this.service.overrideStatus(id, dto.status);
  }

  /** "Perintah sekaligus" from the office view - one instruction, several agents at once. */
  @Post("broadcast") async broadcast(@Body() dto: BroadcastCommandDto) {
    const instruction = await this.withExtras(dto.instruction, dto.attachmentId);
    return this.service.broadcast({ ...dto, instruction });
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

  /** "Arsip" page - every task with output, plus where that output actually lives (GitHub repo / Drive / PDF). */
  @Get("archive") archive() {
    return this.service.archive();
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

  /**
   * Called by apps/worker when the executor run itself blows up (OpenRouter
   * rejects the model, a network error, etc.) - distinct from qa-failed,
   * which assumes a result was actually produced and reviewed. This is what
   * frees the agent's concurrency slot and drains their queued work (see
   * TasksService.failTask) so one bad model slug doesn't freeze that seat.
   */
  @Post(":id/fail") fail(@Param("id") id: string, @Body() body: { reason: string }) {
    return this.service.failTask(id, body.reason);
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
  /**
   * "Tombol read all" for a task's result: Task.resultSummary is hard-capped
   * at 500 chars server-side (see TasksService.recordResult callers in
   * apps/worker) so cards stay short by default, but the FULL executor
   * output already exists as the .md object the worker wrote alongside the
   * PDF. This just reads that back as plain text for the director to expand
   * inline, instead of needing to open the PDF for a couple more sentences.
   */
  @Get(":id/full-text")
  async fullText(@Param("id") id: string, @Res() res: Response) {
    const key = `${id}/executor-output.md`;
    if (!(await this.storage.exists(key))) {
      throw new NotFoundException("Teks lengkap belum tersedia untuk task ini.");
    }
    const buffer = await this.storage.getObjectBuffer(key);
    res.set({ "Content-Type": "text/plain; charset=utf-8" });
    res.send(buffer.toString("utf-8"));
  }

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
