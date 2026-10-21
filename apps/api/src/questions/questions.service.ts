import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KafkaService } from "../kafka/kafka.service";
import { TasksService } from "../tasks/tasks.service";
import { TOPICS } from "@platform/shared";
import { AskDirectorDto, RequestGithubRepoDto } from "./dto";
import { ObjectStorageService } from "../storage/object-storage.service";
import { UploadsService } from "../uploads/uploads.service";
import { LinkReaderService } from "../common/link-reader.service";

/** Machine-parseable prefix the Questions UI uses to show a dedicated "create this repo" card instead of a free-text answer box. */
const REPO_REQUEST_PREFIX = "[REPO_REQUEST:";

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
    private readonly storage: ObjectStorageService,
    private readonly uploads: UploadsService,
    private readonly linkReader: LinkReaderService,
  ) {}

  /** The director's inbox - every question still waiting on an answer. */
  open() {
    return this.prisma.directorQuestion.findMany({
      where: { status: "OPEN" },
      include: {
        agent: { select: { displayName: true, agentRole: { select: { name: true } } } },
        division: { select: { name: true, slug: true } },
        task: { select: { id: true, title: true, projectId: true, project: { select: { name: true } } } },
      },
      orderBy: { askedAt: "asc" },
    });
  }

  /**
   * "Jika sudah dijawab ... akan pindah ke folder archive" - once a question
   * is answered (free-text or a repo-request confirm), it leaves `open()`
   * and lands here instead, grouped client-side by the same `division` the
   * open queue already groups by.
   */
  archived() {
    return this.prisma.directorQuestion.findMany({
      where: { status: "ANSWERED" },
      include: {
        agent: { select: { displayName: true, agentRole: { select: { name: true } } } },
        division: { select: { name: true, slug: true } },
        task: { select: { id: true, title: true, projectId: true, project: { select: { name: true } } } },
      },
      orderBy: { answeredAt: "desc" },
      take: 200,
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

  /**
   * "Nanti PM minta saya tulis nama repositorynya, sebelum melakukan
   * development ... nama repo sendiri itu sesuai dari permintaan PM" - a
   * repo request is the SAME pause-the-task mechanism as `ask()`, just with
   * a machine-parseable question string so the Questions page can render a
   * "create this repo" card (with a pre-filled GitHub link and a confirm
   * button) instead of a free-text answer box. This always goes straight to
   * the director, never through Chief of Staff - creating a GitHub repo
   * isn't something any agent, CoS included, can actually do.
   */
  requestRepo(dto: RequestGithubRepoDto) {
    const question = `${REPO_REQUEST_PREFIX}${dto.repoName}]${dto.reason ? ` ${dto.reason}` : ""}`;
    return this.ask({ agentId: dto.agentId, divisionId: dto.divisionId, taskId: dto.taskId, question });
  }

  /**
   * Director confirms a repo-request question: records which GitHub repo the
   * task's Project now commits to (a small marker object, not a DB column -
   * same pattern as apps/worker's github-output.json, so no migration is
   * needed), then resumes the paused task via the normal `answer()` path.
   */
  async confirmRepo(id: string, repoName: string) {
    const question = await this.prisma.directorQuestion.findUniqueOrThrow({ where: { id } });
    if (!question.question.startsWith(REPO_REQUEST_PREFIX)) {
      throw new BadRequestException("Pertanyaan ini bukan permintaan repository.");
    }
    if (!question.taskId) {
      throw new BadRequestException("Permintaan repository ini tidak terkait task mana pun.");
    }
    const task = await this.prisma.task.findUnique({ where: { id: question.taskId } });
    if (!task?.projectId) {
      throw new NotFoundException("Task untuk permintaan ini tidak terkait project - repo tidak bisa dikaitkan.");
    }

    const owner = process.env.GITHUB_OWNER ?? "";
    await this.storage.putJson(`project/${task.projectId}/github-repo.json`, {
      repo: repoName,
      owner,
      confirmedAt: new Date().toISOString(),
    });

    return this.answer(id, `Repo sudah dibuat: https://github.com/${owner}/${repoName}`);
  }

  /**
   * Director answers - a question tied to a task hands that task straight
   * back to the same agent to resume. `attachmentIds` ("setiap pertanyaan
   * juga ada attachment filenya, bisa dokumen atau folder") and any URL typed into the answer text
   * ("agent juga bisa membaca dari link yang saya berikan") are both folded
   * into what the resumed agent actually sees, the same way chat does it -
   * the question record itself just keeps the short answer text.
   */
  async answer(id: string, answer: string, approverRef?: string, attachmentIds: string[] = []) {
    const storedAnswer = `${answer}${this.uploads.noteForIds(attachmentIds)}`;
    const question = await this.prisma.directorQuestion.update({
      where: { id },
      data: { answer: storedAnswer, status: "ANSWERED", answeredAt: new Date() },
    });
    await this.kafka.publish(TOPICS.TASK_EVENTS, {
      eventType: "director.question.answered",
      aggregateId: question.id,
      payload: { answer, approverRef },
    });

    if (question.taskId) {
      const task = await this.prisma.task.findUniqueOrThrow({ where: { id: question.taskId } });
      // The resumed agent gets the FULL picture - attachment content read
      // verbatim and any linked page fetched - not just the short reference
      // line kept on the question record itself.
      const extras = (
        await Promise.all([this.uploads.describeManyForPrompt(attachmentIds), this.linkReader.describeLinksInText(answer)])
      ).filter((x): x is string => Boolean(x));
      const answerForAgent = [answer, ...extras].join("\n\n");
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          description: [task.description, `[Pertanyaan ke Direktur] ${question.question}`, `[Jawaban Direktur] ${answerForAgent}`]
            .filter(Boolean)
            .join("\n\n"),
        },
      });
      // Resuming (rather than assigning fresh) reuses the SAME assignment
      // that's been open since the agent paused to ask - they never gave up
      // their concurrency slot, so this must not run the normal limit check
      // (and must not create a second assignment row for the same task).
      //
      // "Direktur hanya koordinasi dengan Chief of Staff": a question raised
      // on a division PM's task can be ASKED under Chief of Staff's agentId
      // (the worker forwards it that way once it decides the director really
      // needs to weigh in - see task-assigned.ts), so the director's queue
      // only ever shows Chief of Staff as the asker. That means question.agentId
      // is not necessarily the agent whose task is actually paused - the task's
      // own still-open EXECUTOR assignment is the reliable source for who to
      // resume, so look that up directly instead of trusting question.agentId.
      const openExecutor = await this.prisma.taskAssignment.findFirst({
        where: { taskId: task.id, role: "EXECUTOR", completedAt: null },
        orderBy: { assignedAt: "desc" },
      });
      await this.tasks.resumeExecutor(task.id, openExecutor?.agentId ?? question.agentId);
    }

    return question;
  }
}
