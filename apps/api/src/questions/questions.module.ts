import { Module } from "@nestjs/common";
import { QuestionsService } from "./questions.service";
import { QuestionsController } from "./questions.controller";
import { TasksModule } from "../tasks/tasks.module";

@Module({
  // Needed so answering a question tied to a task can hand that task
  // straight back to the same agent - see QuestionsService.answer.
  imports: [TasksModule],
  providers: [QuestionsService],
  controllers: [QuestionsController],
})
export class QuestionsModule {}
