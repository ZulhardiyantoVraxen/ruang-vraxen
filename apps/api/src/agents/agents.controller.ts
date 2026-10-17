import { Body, Controller, Param, Patch, Post } from "@nestjs/common";
import { AgentsService } from "./agents.service";

@Controller("agents")
export class AgentsController {
  constructor(private readonly service: AgentsService) {}

  @Post() provision(@Body() body: { agentRoleId: string; displayName: string }) {
    return this.service.provision(body.agentRoleId, body.displayName);
  }

  @Patch(":id/status") setStatus(@Param("id") id: string, @Body() body: { status: any }) {
    return this.service.setStatus(id, body.status);
  }

  @Patch(":id/variant") switchVariant(@Param("id") id: string, @Body() body: { variant: "FREE" | "PAID" }) {
    return this.service.switchVariant(id, body.variant as any);
  }
}
