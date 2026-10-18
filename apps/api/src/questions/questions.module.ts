import { Module } from "@nestjs/common";
import { QuestionsService } from "./questions.service";
import { QuestionsController } from "./questions.controller";
import { TasksModule } from "../tasks/tasks.module";
import { StorageModule } from "../storage/storage.module";

@Module({
  // TasksModule: answering a question tied to a task can hand that task
  // straight back to the same agent - see QuestionsService.answer.
  // StorageModule: confirming a repo-request writes the project's GitHub
  // repo marker - see QuestionsService.confirmRepo.
  imports: [TasksModule, StorageModule],
  providers: [QuestionsService],
  controllers: [QuestionsController],
})
export class QuestionsModule {}
