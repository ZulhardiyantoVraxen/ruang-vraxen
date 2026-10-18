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
}
