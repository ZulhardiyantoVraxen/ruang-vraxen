import { Body, Controller, Post } from "@nestjs/common";
import { UsageService } from "./usage.service";
import { ModelVariant } from "@prisma/client";

/** apps/worker reports every model call here - this is the ONE place cost caps are enforced. */
@Controller("usage")
export class UsageController {
  constructor(private readonly service: UsageService) {}

  @Post()
  record(
    @Body()
    body: {
      agentId: string;
      taskId?: string;
      modelUsed: string;
      modelVariant: ModelVariant;
      source: string;
      tokensIn: number;
      tokensOut: number;
    },
  ) {
    return this.service.record(body);
  }
}
