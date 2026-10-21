import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KafkaService } from "../kafka/kafka.service";
import { OpenRouterService } from "../model-routing/openrouter.service";
import { TOPICS, RosterProposal } from "@platform/shared";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./orchestrator.prompt";
import { UploadsService } from "../uploads/uploads.service";

type OrchestratorReply =
  | { type: "question"; question: string }
  | { type: "recommendation"; summary: string; roster: RosterProposal[] };

/**
 * "Dalam 1 tim harus ada 1 PM": exactly one ATAS-tier, requiresApproval
 * role per roster, no more, no fewer - enforced here instead of trusted
 * from the model's JSON. Mutates the roster in place.
 */
function normalizeRosterToSinglePm(roster: RosterProposal[]) {
  const pmCandidates = roster.filter((r) => r.tier === "ATAS" && r.requiresApproval);
  if (pmCandidates.length === 1) return;

  if (pmCandidates.length > 1) {
    // Keep the first as PM, demote the rest to plain ATAS contributors.
    for (const extra of pmCandidates.slice(1)) extra.requiresApproval = false;
    return;
  }

  // Zero PM candidates: promote the first ATAS role if one exists, or turn
  // the first role of the roster into the PM outright as a last resort -
  // a division with no decision point at all is never acceptable here.
  const fallback = roster.find((r) => r.tier === "ATAS") ?? roster[0];
  if (fallback) {
    fallback.tier = "ATAS";
    fallback.requiresApproval = true;
    if (!fallback.roleName.toLowerCase().startsWith("pm")) {
      fallback.roleName = `PM ${fallback.roleName}`;
    }
  }
}

@Injectable()
export class OrchestratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
    private readonly openRouter: OpenRouterService,
    private readonly uploads: UploadsService,
  ) {}

  /** Kick off a new "create a division" conversation with an initial free-text brief. "Setiap input ada lampiran" - e.g. an org chart or compliance doc backing the brief. */
  async start(brief: string, attachmentIds: string[] = []) {
    const briefWithAttachments = `${brief}${this.uploads.noteForIds(attachmentIds)}`;
    const attached = await this.uploads.describeManyForPrompt(attachmentIds);
    const session = await this.prisma.divisionOnboardingSession.create({
      data: { qaLog: [{ question: null, answer: attached ? `${briefWithAttachments}\n\n${attached}` : briefWithAttachments }] },
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
  async answer(sessionId: string, answer: string, attachmentIds: string[] = []) {
    const session = await this.prisma.divisionOnboardingSession.findUniqueOrThrow({ where: { id: sessionId } });
    if (session.status !== "IN_PROGRESS") {
      throw new BadRequestException(`Session ${sessionId} is already ${session.status}`);
    }
    const answerWithAttachments = `${answer}${this.uploads.noteForIds(attachmentIds)}`;
    const attached = await this.uploads.describeManyForPrompt(attachmentIds);
    const qaLog = session.qaLog as any[];
    qaLog[qaLog.length - 1] = { ...qaLog[qaLog.length - 1], answer: attached ? `${answerWithAttachments}\n\n${attached}` : answerWithAttachments };
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

    const { content, tokensIn, tokensOut } = await this.openRouter.chatWithFallback(
      route,
      [
        { role: "system", content: ORCHESTRATOR_SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      { aggregateId: sessionId, source: "onboarding" },
    );

    const parsed = JSON.parse(content) as OrchestratorReply;

    if (parsed.type === "recommendation") {
      // The model is instructed to return exactly one PM/ATAS role, but LLM
      // output isn't a contract - enforce the "1 tim, 1 PM" rule here rather
      // than trusting it blindly, same philosophy as the QA-verdict and
      // triage-decision fail-safes elsewhere in this codebase.
      normalizeRosterToSinglePm(parsed.roster);
    }

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
        // Stored as {summary, roster} together (not just the roster array)
        // so confirm() can use the Auditor's own write-up as the division's
        // description by default - see confirm() below.
        data: { status: "RECOMMENDED", recommendedRoster: { summary: parsed.summary, roster: parsed.roster } as any },
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
    const stored = session.recommendedRoster as unknown as { summary: string; roster: RosterProposal[] };
    const roster = stored.roster;
    // The Auditor already wrote the division's requirements up as part of
    // the recommendation ("summary", stored alongside the roster) - the
    // director only has to type a description to OVERRIDE it, never as a
    // requirement to get past this step.
    const auditorDescription = description?.trim() || stored.summary;

    const division = await this.prisma.$transaction(async (tx) => {
      const division = await tx.division.create({
        data: { slug, name, description: auditorDescription, status: "ACTIVE" },
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
