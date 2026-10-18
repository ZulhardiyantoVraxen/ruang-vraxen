import { Module } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { TasksController } from "./tasks.controller";
import { StorageModule } from "../storage/storage.module";
import { UploadsModule } from "../uploads/uploads.module";

@Module({
  imports: [StorageModule, UploadsModule],
  providers: [TasksService],
  controllers: [TasksController],
  exports: [TasksService],
})
export class TasksModule {}
