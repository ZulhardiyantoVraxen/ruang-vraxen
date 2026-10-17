import OpenAI from "openai";

/**
 * Thin, framework-free OpenRouter client - no Prisma, no NestJS DI. Used by
 * both apps/api (wrapped in OpenRouterService, which adds tier->model
 * resolution from the database) and apps/worker directly. Keeping the raw
 * "call the model" part here means there is exactly one place that talks to
 * OpenRouter's HTTP API.
 */
export class OpenRouterClient {
  private readonly client: OpenAI;

  constructor(apiKey: string | undefined) {
    this.client = new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
  }

  async chat(modelId: string, messages: OpenAI.Chat.ChatCompletionMessageParam[]) {
    const completion = await this.client.chat.completions.create({ model: modelId, messages });
    return {
      content: completion.choices[0]?.message?.content ?? "",
      tokensIn: completion.usage?.prompt_tokens ?? 0,
      tokensOut: completion.usage?.completion_tokens ?? 0,
    };
  }
}
