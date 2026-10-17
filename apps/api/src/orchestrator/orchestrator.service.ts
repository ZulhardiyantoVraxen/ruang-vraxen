import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KafkaService } from "../kafka/kafka.service";
import { OpenRouterService } from "../model-routing/openrouter.service";
import { TOPICS, RosterProposal } from "@platform/shared";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./orchestrator.prompt";

type OrchestratorReply =
  | { type: "question"; question: string }
  | { type: "recommendation"; summary: string; roster: RosterProposal[] };

@Injectable()
export class OrchestratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
    private readonly openRouter: OpenRouterService,
  ) {}

  /** Kick off a new "create a division" conversation with an initial free-text brief. */
  async start(brief: string) {
    const session = await this.prisma.divisionOnboardingSession.create({
      data: { qaLog: [{ question: null, answer: brief }] },
    });
    await this.kafka.publish(TOPICS.DIVISION_EVENTS, {
      eventType: "division.onboarding.started",
      aggregateId: session.id,
      payload: { brief },
    });
    const reply = await this.ask(session.id);
    return { session, reply };
  }

  /** Answer the orchestrator's last question; it then asks the next one or recommends a roster. */
  async answer(sessionId: string, answer: string) {
    const session = await this.prisma.divisionOnboardingSession.findUniqueOrThrow({ where: { id: sessionId } });
    if (session.status !== "IN_PROGRESS") {
      throw new BadRequestException(`Session ${sessionId} is already ${session.status}`);
    }
    const qaLog = session.qaLog as any[];
    qaLog[qaLog.length - 1] = { ...qaLog[qaLog.length - 1], answer };
    await this.prisma.divisionOnboardingSession.update({ where: { id: sessionId }, data: { qaLog } });
    await this.kafka.publish(TOPICS.DIVISION_EVENTS, {
      eventType: "division.onboarding.answered",
      aggregateId: sessionId,
      payload: { answer },
    });
    return this.ask(sessionId);
  }

  /** Calls the ATAS-tier model to get the next question or the final roster recommendation. */
  private async ask(sessionId: string): Promise<OrchestratorReply> {
    const session = await this.prisma.divisionOnboardingSession.findUniqueOrThrow({ where: { id: sessionId } });
    const route = await this.openRouter.resolveModel("ATAS", "PAID"); // onboarding always paid tier

    const transcript = (session.qaLog as any[])
      .map((qa) => `Q: ${qa.question ?? "(brief awal)"}\nA: ${qa.answer ?? "(belum dijawab)"}`)
      .join("\n\n");

    const { content, tokensIn, tokensOut } = await this.openRouter.chat(route.modelId, [
      { role: "system", content: ORCHESTRATOR_SYSTEM_PROMPT },
      { role: "user", content: transcript },
    ]);

    const parsed = JSON.parse(content) as OrchestratorReply;

    if (parsed.type === "question") {
      const qaLog = [...(session.qaLog as any[]), { question: parsed.question, answer: null }];
      await this.prisma.divisionOnboardingSession.update({ where: { id: sessionId }, data: { qaLog } });
      await this.kafka.publish(TOPICS.DIVISION_EVENTS, {
        eventType: "division.onboarding.question_asked",
        aggregateId: sessionId,
        payload: { question: parsed.question },
      });
    } else {
      await this.prisma.divisionOnboardingSession.update({
        where: { id: sessionId },
        data: { status: "RECOMMENDED", recommendedRoster: parsed.roster as any },
      });
      await this.kafka.publish(TOPICS.DIVISION_EVENTS, {
        eventType: "division.roster.recommended",
        aggregateId: sessionId,
        payload: { roster: parsed.roster, summary: parsed.summary },
      });
    }

    // Usage recording is deliberately not wired to a specific agentId here -
    // the onboarding session itself is the "agent" of record until a real
    // Division/Agent exists; wire this to UsageService once that's decided.
    void tokensIn;
    void tokensOut;

    return parsed;
  }

  /** User confirms the recommended roster -> materialize the Division + AgentRoles. */
  async confirm(sessionId: string, slug: string, name: string, description?: string) {
    const session = await this.prisma.divisionOnboardingSession.findUniqueOrThrow({ where: { id: sessionId } });
    if (session.status !== "RECOMMENDED" || !session.recommendedRoster) {
      throw new BadRequestException(`Session ${sessionId} has no recommendation to confirm yet`);
    }
    const roster = session.recommendedRoster as unknown as RosterProposal[];

    const division = await this.prisma.$transaction(async (tx) => {
      const division = await tx.division.create({
        data: { slug, name, description, status: "ACTIVE" },
      });
      for (const role of roster) {
        const modelClass = await tx.modelClass.findUniqueOrThrow({ where: { tier: role.tier as any } });
        await tx.agentRole.create({
          data: {
            divisionId: division.id,
            name: role.roleName,
            tier: role.tier as any,
            modelClassId: modelClass.id,
            responsibilities: role.responsibilities,
            requiresApproval: role.requiresApproval,
            maxConcurrentTasks: role.maxConcurrentTasks,
          },
        });
      }
      return division;
    });

    await this.prisma.divisionOnboardingSession.update({
      where: { id: sessionId },
      data: { status: "CONFIRMED", divisionId: division.id },
    });
    await this.kafka.publish(TOPICS.DIVISION_EVENTS, {
      eventType: "division.roster.confirmed",
      aggregateId: division.id,
      payload: { sessionId },
    });

    return division;
  }
}
