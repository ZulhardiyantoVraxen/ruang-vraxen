import { Module } from "@nestjs/common";
import { ChatService } from "./chat.service";
import { ChatController } from "./chat.controller";
import { ModelRoutingModule } from "../model-routing/model-routing.module";
import { TasksModule } from "../tasks/tasks.module";
import { UsageModule } from "../usage/usage.module";
import { UploadsModule } from "../uploads/uploads.module";

@Module({
  imports: [ModelRoutingModule, TasksModule, UsageModule, UploadsModule],
  providers: [ChatService],
  controllers: [ChatController],
})
export class ChatModule {}
