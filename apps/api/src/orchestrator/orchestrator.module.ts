import { Module } from "@nestjs/common";
import { OrchestratorService } from "./orchestrator.service";
import { OrchestratorController } from "./orchestrator.controller";
import { ModelRoutingModule } from "../model-routing/model-routing.module";

@Module({
  imports: [ModelRoutingModule],
  providers: [OrchestratorService],
  controllers: [OrchestratorController],
})
export class OrchestratorModule {}
