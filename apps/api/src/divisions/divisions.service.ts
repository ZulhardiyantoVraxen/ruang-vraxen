import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KafkaService } from "../kafka/kafka.service";
import { TOPICS, inferRoleCapability } from "@platform/shared";
import { CreateAgentRoleDto, CreateDivisionDto, QuickAddPersonnelDto } from "./dto";
import { OpenRouterService } from "../model-routing/openrouter.service";
import { AgentsService } from "../agents/agents.service";

@Injectable()
export class DivisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
    private readonly openRouter: OpenRouterService,
    private readonly agents: AgentsService,
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

  /**
   * "Saya ingin bisa menambah personel didalam menu itu, Perannya saya yang
   * buat, untuk Nama dan Model itu generate dari agentic AI" - the director
   * types only the role name (and optionally what it does); everything else
   * is inferred/generated:
   *  - Tier: inferRoleCapability() reads the role name + responsibilities
   *    and maps CODE/REASONING/VISION -> AHLI, GENERAL -> RUTIN. ATAS is
   *    deliberately never auto-picked - it's reserved for roles the
   *    director creates by hand via addRole(), since ATAS's ModelClass has
   *    no free-tier fallback (always paid).
   *  - Model: comes for free once the tier is picked - AgentsService /
   *    OpenRouterService already resolve an agent's actual model from its
   *    role's tier + modelVariant, nothing extra to generate here.
   *  - Name: asks the model itself for one plausible Indonesian human name
   *    that fits the role, via the same OpenRouterService every other chat
   *    feature in this app already uses.
   */
  async quickAddPersonnel(divisionSlug: string, dto: QuickAddPersonnelDto) {
    const division = await this.getBySlug(divisionSlug);
    const capability = inferRoleCapability(dto.roleName, dto.responsibilities);
    const tier = capability === "GENERAL" ? "RUTIN" : "AHLI";
    const modelClass = await this.prisma.modelClass.findUniqueOrThrow({ where: { tier } });

    const displayName = await this.generatePersonnelName(dto.roleName, dto.responsibilities);

    const role = await this.prisma.agentRole.create({
      data: {
        divisionId: division.id,
        name: dto.roleName,
        tier,
        modelClassId: modelClass.id,
        responsibilities: dto.responsibilities,
        maxConcurrentTasks: 1,
        requiresApproval: false,
      },
    });
    const agent = await this.agents.provision(role.id, displayName);
    return { role, agent };
  }

  /** Asks the model for one short, plausible Indonesian full name for a new staff member in this role - falls back to a generic placeholder if the call fails for any reason, since name generation should never block the actual hire. */
  private async generatePersonnelName(roleName: string, responsibilities?: string | null): Promise<string> {
    try {
      const decision = await this.openRouter.resolveModel("RUTIN", "FREE", { roleName, responsibilities });
      const response = await this.openRouter.chatWithFallback(decision, [
        {
          role: "system",
          content:
            "Kamu memberi nama untuk staf baru di sebuah kantor virtual Indonesia. Balas HANYA dengan satu nama lengkap orang Indonesia yang masuk akal untuk peran yang diberikan, tanpa gelar, tanpa penjelasan, tanpa tanda kutip - hanya nama, maksimal 3 kata.",
        },
        { role: "user", content: `Peran: ${roleName}${responsibilities ? `\nTanggung jawab: ${responsibilities}` : ""}` },
      ]);
      const name = response.content
        ?.trim()
        .replace(/^["'“‘]+|["'”’]+$/g, "")
        .split("\n")[0]
        ?.slice(0, 60);
      return name && name.length > 1 ? name : `Staf ${roleName}`;
    } catch {
      return `Staf ${roleName}`;
    }
  }
}
