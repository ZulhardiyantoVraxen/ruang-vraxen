import { Module } from "@nestjs/common";
import { ApprovalsService } from "./approvals.service";
import { ApprovalsController } from "./approvals.controller";
import { TasksModule } from "../tasks/tasks.module";
import { UploadsModule } from "../uploads/uploads.module";

@Module({
  // TasksModule: so an approved UI/UX design task can hand itself off to
  // Developer automatically - see ApprovalsService.decide. UploadsModule:
  // attachments on an approval decision's notes.
  imports: [TasksModule, UploadsModule],
  providers: [ApprovalsService],
  controllers: [ApprovalsController],
})
export class ApprovalsModule {}
