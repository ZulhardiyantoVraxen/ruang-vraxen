import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { ApprovalsService } from "./approvals.service";

@Controller("approvals")
export class ApprovalsController {
  constructor(private readonly service: ApprovalsService) {}

  @Get("pending") pending() {
    return this.service.pending();
  }

  /** Already approved/rejected - the archive folder for the Approvals page. */
  @Get("decided") decided() {
    return this.service.decided();
  }

  @Patch(":id/decide")
  decide(@Param("id") id: string, @Body() body: { status: "APPROVED" | "REJECTED"; approverRef: string; notes?: string }) {
    return this.service.decide(id, body.status, body.approverRef, body.notes);
  }
}
