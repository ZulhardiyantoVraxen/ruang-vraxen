import { Module } from "@nestjs/common";
import { ApprovalsService } from "./approvals.service";
import { ApprovalsController } from "./approvals.controller";
import { TasksModule } from "../tasks/tasks.module";

@Module({
  // Needed so an approved UI/UX design task can hand itself off to
  // Developer automatically - see ApprovalsService.decide.
  imports: [TasksModule],
  providers: [ApprovalsService],
  controllers: [ApprovalsController],
})
export class ApprovalsModule {}
