import { Module } from "@nestjs/common";
import { MeetingsService } from "./meetings.service";
import { MeetingsController } from "./meetings.controller";
import { ModelRoutingModule } from "../model-routing/model-routing.module";
import { UsageModule } from "../usage/usage.module";
import { TasksModule } from "../tasks/tasks.module";

@Module({
  imports: [ModelRoutingModule, UsageModule, TasksModule],
  providers: [MeetingsService],
  controllers: [MeetingsController],
})
export class MeetingsModule {}
