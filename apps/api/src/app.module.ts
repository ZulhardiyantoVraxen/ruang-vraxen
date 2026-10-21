import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { KafkaModule } from "./kafka/kafka.module";
import { ModelRoutingModule } from "./model-routing/model-routing.module";
import { DivisionsModule } from "./divisions/divisions.module";
import { AgentsModule } from "./agents/agents.module";
import { TasksModule } from "./tasks/tasks.module";
import { ApprovalsModule } from "./approvals/approvals.module";
import { UsageModule } from "./usage/usage.module";
import { OrchestratorModule } from "./orchestrator/orchestrator.module";
import { QuestionsModule } from "./questions/questions.module";
import { ProjectsModule } from "./projects/projects.module";
import { ChatModule } from "./chat/chat.module";
import { StorageModule } from "./storage/storage.module";
import { UploadsModule } from "./uploads/uploads.module";
import { MeetingsModule } from "./meetings/meetings.module";
import { ReleasesModule } from "./releases/releases.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    KafkaModule,
    ModelRoutingModule,
    DivisionsModule,
    AgentsModule,
    TasksModule,
    ApprovalsModule,
    UsageModule,
    OrchestratorModule,
    QuestionsModule,
    ProjectsModule,
    ChatModule,
    StorageModule,
    UploadsModule,
    MeetingsModule,
    ReleasesModule,
  ],
})
export class AppModule {}
