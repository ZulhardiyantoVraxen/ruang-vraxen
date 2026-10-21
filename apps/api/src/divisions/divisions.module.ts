import { Module } from "@nestjs/common";
import { DivisionsService } from "./divisions.service";
import { DivisionsController } from "./divisions.controller";
import { ModelRoutingModule } from "../model-routing/model-routing.module";
import { AgentsModule } from "../agents/agents.module";
import { UploadsModule } from "../uploads/uploads.module";

@Module({
  imports: [ModelRoutingModule, AgentsModule, UploadsModule],
  providers: [DivisionsService],
  controllers: [DivisionsController],
  exports: [DivisionsService],
})
export class DivisionsModule {}
