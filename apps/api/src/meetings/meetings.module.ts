import { Module } from "@nestjs/common";
import { MeetingsService } from "./meetings.service";
import { MeetingsController } from "./meetings.controller";
import { ModelRoutingModule } from "../model-routing/model-routing.module";
import { UsageModule } from "../usage/usage.module";
import { TasksModule } from "../tasks/tasks.module";
import { UploadsModule } from "../uploads/uploads.module";
import { LinkReaderModule } from "../common/link-reader.module";
import { StorageModule } from "../storage/storage.module";
import { RealtimeModule } from "../realtime/realtime.module";

@Module({
  imports: [ModelRoutingModule, UsageModule, TasksModule, UploadsModule, LinkReaderModule, StorageModule, RealtimeModule],
  providers: [MeetingsService],
  controllers: [MeetingsController],
})
export class MeetingsModule {}
