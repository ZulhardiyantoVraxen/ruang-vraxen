import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KafkaService } from "../kafka/kafka.service";
import { TOPICS } from "@platform/shared";
import { CreateAgentRoleDto, CreateDivisionDto } from "./dto";

@Injectable()
export class DivisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
  ) {}

  /** Every division (and its roster below) is a row, created at runtime - never hardcoded. */
  list() {
    return this.prisma.division.findMany({
      include: {
        agentRoles: { include: { agents: true, modelClass: true } },
        // Top-level tasks only (no subtasks) - just enough for the office
        // view's per-division completion % and "what are they working on"
        // whiteboard detail, the agent-detail modal's "tugas saya" list, and
        // the Task Board's PIC/deadline/project columns - so this stays
        // light even with a busy backlog (no subtask fan-out, no QA prompt
        // text).
        tasks: {
          where: { parentTaskId: null },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            requiresApproval: true,
            resultSummary: true,
            updatedAt: true,
            createdAt: true,
            dueAt: true,
            projectId: true,
            project: { select: { id: true, name: true } },
            assignments: {
              orderBy: { assignedAt: "desc" },
              select: { role: true, agent: { select: { id: true, displayName: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async getBySlug(slug: string) {
    const division = await this.prisma.division.findUnique({
      where: { slug },
      include: {
        agentRoles: { include: { agents: true, modelClass: true } },
        tasks: {
          where: { parentTaskId: null },
          orderBy: { createdAt: "desc" },
          // Full assignment history per task - who actually worked it and
          // when - so a page like "PIC Chief of Staff" can show a real
          // riwayat (status + waktu + siapa yang membalas), not just the
          // bare current status.
          include: {
            assignments: {
              include: { agent: { select: { displayName: true, agentRole: { select: { name: true } } } } },
              orderBy: { assignedAt: "asc" },
            },
          },
        },
      },
    });
    if (!division) throw new NotFoundException(`Division "${slug}" not found`);
    return division;
  }

  async create(dto: CreateDivisionDto) {
    const division = await this.prisma.division.create({ data: dto });
    await this.kafka.publish(TOPICS.DIVISION_EVENTS, {
      eventType: "division.activated",
      aggregateId: division.id,
      payload: { slug: division.slug },
    });
    return division;
  }

  /**
   * Add a role to an EXISTING division - this is how "1 divisi mengerjakan
   * beberapa pekerjaan sekaligus" scales: add more roles (or more Agent
   * instances of the same role, see AgentsService) without touching code.
   */
  async addRole(divisionSlug: string, dto: CreateAgentRoleDto) {
    const division = await this.getBySlug(divisionSlug);
    const modelClass = await this.prisma.modelClass.findUniqueOrThrow({
      where: { tier: dto.tier as any },
    });
    return this.prisma.agentRole.create({
      data: {
        divisionId: division.id,
        name: dto.name,
        tier: dto.tier as any,
        modelClassId: modelClass.id,
        responsibilities: dto.responsibilities,
        maxConcurrentTasks: dto.maxConcurrentTasks ?? 1,
        requiresApproval: dto.requiresApproval ?? false,
      },
    });
  }
}
