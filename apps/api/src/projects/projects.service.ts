import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProjectDto } from "./dto";
import { UploadsService } from "../uploads/uploads.service";

/**
 * "Saya ingin ada project yang sedang dikerjakan" - a Project is just a
 * director-visible label that groups Tasks across divisions, so the Task
 * Board can show real work in motion instead of tasks sitting isolated in
 * their own division column. Nothing enforces a Project's lifecycle beyond
 * its own status field; archiving one never touches its tasks.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  list() {
    return this.prisma.project.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "desc" },
    });
  }

  /** "Setiap input ada lampiran" - e.g. a brief or budget doc backing the new project. */
  async create(dto: CreateProjectDto) {
    const attachmentIds = dto.attachmentIds ?? [];
    const attached = await this.uploads.describeManyForPrompt(attachmentIds);
    const note = this.uploads.noteForIds(attachmentIds);
    const description = dto.description ? `${dto.description}${note}` : note || undefined;
    return this.prisma.project.create({
      data: {
        name: dto.name,
        description: attached ? `${description ?? ""}\n\n${attached}`.trim() : description,
      },
    });
  }
}
