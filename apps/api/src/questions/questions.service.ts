import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KafkaService } from "../kafka/kafka.service";
import { TasksService } from "../tasks/tasks.service";
import { TOPICS } from "@platform/shared";
import { AskDirectorDto } from "./dto";

/**
 * "PM harus lebih interaktif bertanya kepada direktur": any PM/decision-point
 * agent (AgentRole.requiresApproval=true - Chief of Staff included) can stop
 * mid-task and raise a question here instead of forcing a guess. The
 * director's queue for these lives at /questions, parallel to /approvals.
 */
@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
    private readonly tasks: TasksService,
  ) {}

  /** The director's inbox - every question still waiting on an answer. */
  open() {
    return this.prisma.directorQuestion.findMany({
      where: { status: "OPEN" },
      include: {
        agent: { select: { displayName: true, agentRole: { select: { name: true } } } },
        division: { select: { name: true, slug: true } },
        task: { select: { id: true, title: true } },
      },
      orderBy: { askedAt: "asc" },
    });
  }

  /** Worker calls this when a PM-tier executor's structured reply is {type:"question",...}. */
  async ask(dto: AskDirectorDto) {
    const question = await this.prisma.directorQuestion.create({ data: dto });
    if (dto.taskId) {
      // Paused, not stuck - the agent picks the SAME task back up the moment
      // this is answered (see answer() below), it just can't move forward
      // without the director's call first.
      await this.prisma.task.update({ where: { id: dto.taskId }, data: { status: "AWAITING_DIRECTOR" } });
    }
    await this.kafka.publish(TOPICS.TASK_EVENTS, {
      eventType: "director.question.asked",
      aggregateId: question.id,
      payload: { taskId: dto.taskId, agentId: dto.agentId, question: dto.question },
    });
    return question;
  }

  /** Director answers - a question tied to a task hands that task straight back to the same agent to resume. */
  async answer(id: string, answer: string, approverRef?: string) {
    const question = await this.prisma.directorQuestion.update({
      where: { id },
      data: { answer, status: "ANSWERED", answeredAt: new Date() },
    });
    await this.kafka.publish(TOPICS.TASK_EVENTS, {
      eventType: "director.question.answered",
      aggregateId: question.id,
      payload: { answer, approverRef },
    });

    if (question.taskId) {
      const task = await this.prisma.task.findUniqueOrThrow({ where: { id: question.taskId } });
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          description: [task.description, `[Pertanyaan ke Direktur] ${question.question}`, `[Jawaban Direktur] ${answer}`]
            .filter(Boolean)
            .join("\n\n"),
        },
      });
      // Resuming (rather than assigning fresh) reuses the SAME assignment
      // that's been open since the agent paused to ask - they never gave up
      // their concurrency slot, so this must not run the normal limit check
      // (and must not create a second assignment row for the same task).
      await this.tasks.resumeExecutor(task.id, question.agentId);
    }

    return question;
  }
}
