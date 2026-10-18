import { IsOptional, IsString } from "class-validator";

/** Worker's own write path when a PM/decision-point executor needs the director's input - see QuestionsService.ask. */
export class AskDirectorDto {
  @IsString() agentId!: string;
  @IsString() divisionId!: string;
  @IsOptional() @IsString() taskId?: string;
  @IsString() question!: string;
}

export class AnswerDirectorQuestionDto {
  @IsString() answer!: string;
  @IsOptional() @IsString() approverRef?: string;
  /** Id returned by POST /uploads - "setiap pertanyaan juga ada attachment filenya". */
  @IsOptional() @IsString() attachmentId?: string;
}

/**
 * "Nanti PM minta saya tulis nama repositorynya, sebelum melakukan
 * development" - a PM pauses a project task to ask the DIRECTOR (never
 * Chief of Staff - creating a GitHub repo isn't something any agent can do)
 * to create a specific repo by name before it writes any code.
 */
export class RequestGithubRepoDto {
  @IsString() agentId!: string;
  @IsString() divisionId!: string;
  @IsOptional() @IsString() taskId?: string;
  @IsString() repoName!: string;
  @IsOptional() @IsString() reason?: string;
}

export class ConfirmRepoDto {
  /** The name the director actually used when creating the repo - may differ from what the PM proposed. */
  @IsString() repoName!: string;
}
