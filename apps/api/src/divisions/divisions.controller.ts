import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { DivisionsService } from "./divisions.service";
import { CreateAgentRoleDto, CreateDivisionDto } from "./dto";

@Controller("divisions")
export class DivisionsController {
  constructor(private readonly service: DivisionsService) {}

  @Get() list() {
    return this.service.list();
  }

  @Get(":slug") get(@Param("slug") slug: string) {
    return this.service.getBySlug(slug);
  }

  @Post() create(@Body() dto: CreateDivisionDto) {
    return this.service.create(dto);
  }

  @Post(":slug/roles") addRole(@Param("slug") slug: string, @Body() dto: CreateAgentRoleDto) {
    return this.service.addRole(slug, dto);
  }
}
