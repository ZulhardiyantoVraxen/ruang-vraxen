import { Module } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { TasksController } from "./tasks.controller";
import { StorageModule } from "../storage/storage.module";
import { UploadsModule } from "../uploads/uploads.module";
import { LinkReaderModule } from "../common/link-reader.module";

@Module({
  imports: [StorageModule, UploadsModule, LinkReaderModule],
  providers: [TasksService],
  controllers: [TasksController],
  exports: [TasksService],
})
export class TasksModule {}
