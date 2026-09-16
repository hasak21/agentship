import type { LLMProvider, LLMRequestOptions } from "./types";

const PUBLIC_PROVIDERS = new Set<LLMProvider>([
  "openai-compatible",
  "deepseek",
  "anthropic",
  "gemini",
  "ollama",
]);

export class PublicLLMInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicLLMInputError";
  }
}

/** Convert untrusted route input into the LLM options public callers may control. */
export function parsePublicLLMOptions(
  body: Record<string, unknown>
): Pick<LLMRequestOptions, "model" | "provider"> {
  if (Object.hasOwn(body, "apiKey") || Object.hasOwn(body, "baseUrl")) {
    throw new PublicLLMInputError(
      "API credentials and provider URLs cannot be supplied through public endpoints."
    );
  }

  const model = optionalString(body.model, "model", 200);
  const rawProvider = optionalString(body.provider, "provider", 40);
  if (rawProvider && !PUBLIC_PROVIDERS.has(rawProvider as LLMProvider)) {
    throw new PublicLLMInputError(`Unsupported provider: '${rawProvider}'.`);
  }

  return {
    model,
    provider: rawProvider as LLMProvider | undefined,
  };
}

function optionalString(
  value: unknown,
  field: string,
  maximumLength: number
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new PublicLLMInputError(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new PublicLLMInputError(
      `${field} must be at most ${maximumLength} characters.`
    );
  }
  return normalized || undefined;
}
