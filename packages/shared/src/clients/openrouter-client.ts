import OpenAI from "openai";

export interface ChatResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ChatAttempt {
  modelId: string;
  error?: string;
}

export interface ChatWithFallbackResult extends ChatResult {
  /** The model that actually produced this result - may differ from the first entry in the chain. */
  modelId: string;
  /** True iff the primary model failed and a later model in the chain answered instead. */
  usedFallback: boolean;
  /** Every model tried, in order, with the error (if any) each one hit - for logging/telemetry, never thrown to the caller directly. */
  attempts: ChatAttempt[];
}

/** Thrown only when EVERY model in the chain failed. Carries the full attempt log so the caller can report exactly what was tried. */
export class AllModelsFailedError extends Error {
  constructor(public readonly attempts: ChatAttempt[]) {
    super(`Semua model gagal dipanggil (${attempts.map((a) => a.modelId).join(" -> ")}): ${attempts.at(-1)?.error ?? "unknown error"}`);
    this.name = "AllModelsFailedError";
  }
}

/**
 * Is this error worth retrying on a DIFFERENT model? Rate limits, timeouts,
 * and upstream/provider 5xx errors are - the model itself is fine, this
 * specific provider route just can't serve the request right now (exactly
 * the "self-healing saat rate limit" case). 401/403 (bad API key / access
 * denied) are NOT - the same key will fail on every model, so burning
 * through the whole fallback chain just delays an error that needs a human
 * to fix the key, not a different model. 404 IS retried - OpenRouter
 * returns 404 for a model that has been deprecated/pulled from a provider
 * (see packages/db/prisma/seed.ts's note on a Kafka-image-style removal),
 * which another model in the chain can route around just as well as a 429.
 */
function isRetryableOpenRouterError(err: unknown): boolean {
  const status = (err as { status?: number; response?: { status?: number } })?.status ?? (err as { response?: { status?: number } })?.response?.status;
  if (typeof status === "number") {
    if (status === 401 || status === 403) return false;
    return status === 404 || status === 408 || status === 429 || status >= 500;
  }
  const code = (err as { code?: string })?.code;
  if (code && ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "EPIPE"].includes(code)) return true;
  return false;
}

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

  async chat(modelId: string, messages: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<ChatResult> {
    const completion = await this.client.chat.completions.create({ model: modelId, messages });
    return {
      content: completion.choices[0]?.message?.content ?? "",
      tokensIn: completion.usage?.prompt_tokens ?? 0,
      tokensOut: completion.usage?.completion_tokens ?? 0,
    };
  }

  /**
   * Self-healing entry point: calls `primaryModelId`, and on a retryable
   * failure (rate-limit/timeout/5xx/deprecated-model-404) automatically
   * tries each of `fallbackModelIds` in order instead of surfacing the
   * error to the caller. A non-retryable error (bad request, auth) still
   * throws immediately - a different model can't fix those.
   *
   * This is the single place fallback behavior lives, so apps/api (chat,
   * onboarding) and apps/worker (task execution, QA, PM relay) all get the
   * same resilience without each call site re-implementing retry logic.
   */
  async chatWithFallback(
    primaryModelId: string,
    fallbackModelIds: string[],
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
  ): Promise<ChatWithFallbackResult> {
    const chain = [primaryModelId, ...fallbackModelIds];
    const attempts: ChatAttempt[] = [];

    for (let i = 0; i < chain.length; i++) {
      const modelId = chain[i];
      try {
        const result = await this.chat(modelId, messages);
        attempts.push({ modelId });
        return { ...result, modelId, usedFallback: i > 0, attempts };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        attempts.push({ modelId, error: message });
        const isLastInChain = i === chain.length - 1;
        if (isLastInChain || !isRetryableOpenRouterError(err)) {
          if (isLastInChain) throw new AllModelsFailedError(attempts);
          throw err; // non-retryable - rethrow the original error as-is, don't mask it as AllModelsFailedError
        }
        // Brief backoff before the next model - gives a transient provider
        // hiccup (as opposed to a hard rate-limit) a moment to clear, and
        // avoids hammering OpenRouter with an instant retry burst.
        await new Promise((resolve) => setTimeout(resolve, 300 * (i + 1)));
      }
    }
    // Unreachable: chain always has >=1 element, and the loop above always
    // either returns or throws on its last iteration.
    throw new AllModelsFailedError(attempts);
  }
}
