import { Module } from "@nestjs/common";
import { QuestionsService } from "./questions.service";
import { QuestionsController } from "./questions.controller";
import { TasksModule } from "../tasks/tasks.module";
import { StorageModule } from "../storage/storage.module";
import { UploadsModule } from "../uploads/uploads.module";
import { LinkReaderModule } from "../common/link-reader.module";

@Module({
  // TasksModule: answering a question tied to a task can hand that task
  // straight back to the same agent - see QuestionsService.answer.
  // StorageModule: confirming a repo-request writes the project's GitHub
  // repo marker - see QuestionsService.confirmRepo.
  // UploadsModule/LinkReaderModule: an answer can carry a file attachment
  // and/or links - see QuestionsService.answer.
  imports: [TasksModule, StorageModule, UploadsModule, LinkReaderModule],
  providers: [QuestionsService],
  controllers: [QuestionsController],
})
export class QuestionsModule {}
