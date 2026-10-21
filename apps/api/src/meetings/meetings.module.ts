import { Module } from "@nestjs/common";
import { MeetingsService } from "./meetings.service";
import { MeetingsController } from "./meetings.controller";
import { ModelRoutingModule } from "../model-routing/model-routing.module";
import { UsageModule } from "../usage/usage.module";

@Module({
  imports: [ModelRoutingModule, UsageModule],
  providers: [MeetingsService],
  controllers: [MeetingsController],
})
export class MeetingsModule {}
