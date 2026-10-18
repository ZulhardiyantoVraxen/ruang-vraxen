import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProjectDto } from "./dto";

/**
 * "Saya ingin ada project yang sedang dikerjakan" - a Project is just a
 * director-visible label that groups Tasks across divisions, so the Task
 * Board can show real work in motion instead of tasks sitting isolated in
 * their own division column. Nothing enforces a Project's lifecycle beyond
 * its own status field; archiving one never touches its tasks.
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.project.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "desc" },
    });
  }

  create(dto: CreateProjectDto) {
    return this.prisma.project.create({ data: dto });
  }
}
