// Universal LLM Client Engine for AgentShip
// Supports OpenAI-compatible APIs (DeepSeek, OpenRouter, Groq, Ollama, OpenAI, Qwen),
// Anthropic Claude Messages API, and optional providers.

import {
  LLMMessage,
  LLMProvider,
  LLMRequestOptions,
  LLMResponse,
  LLMSource,
  ModelPreset,
} from "./types";

export const UNIVERSAL_MODEL_PRESETS: ModelPreset[] = [
  {
    id: "deepseek-v3",
    name: "DeepSeek V3 (Chat)",
    provider: "deepseek",
    defaultModel: "deepseek-chat",
    description: "High-performance SOTA coding and reasoning model at ultra-low cost.",
    badge: "Fast & Precise",
    recommended: true,
  },
  {
    id: "deepseek-r1",
    name: "DeepSeek R1 (Reasoner)",
    provider: "deepseek",
    defaultModel: "deepseek-reasoner",
    description: "Deep chain-of-thought reasoning for complex architectural and algorithmic tasks.",
    badge: "CoT Reasoning",
    recommended: true,
  },
  {
    id: "claude-3-7-sonnet",
    name: "Claude 3.7 Sonnet",
    provider: "anthropic",
    defaultModel: "claude-3-7-sonnet-20250219",
    description: "Anthropic flagship hybrid reasoning model with superior code comprehension.",
    badge: "Hybrid SOTA",
  },
  {
    id: "claude-3-5-haiku",
    name: "Claude 3.5 Haiku",
    provider: "anthropic",
    defaultModel: "claude-3-5-haiku-latest",
    description: "High speed, lightweight model for instant audits and rapid fan-outs.",
    badge: "Ultra Fast",
  },
  {
    id: "gpt-4o",
    name: "OpenAI GPT-4o",
    provider: "openai-compatible",
    defaultModel: "gpt-4o",
    description: "Standard OpenAI multi-modal flagship model.",
    badge: "OpenAI SOTA",
  },
  {
    id: "gpt-4o-mini",
    name: "OpenAI GPT-4o-mini",
    provider: "openai-compatible",
    defaultModel: "gpt-4o-mini",
    description: "Cost-effective, low-latency baseline for multi-agent workers.",
    badge: "Efficient",
  },
  {
    id: "ollama-local",
    name: "Ollama (Local / Self-Hosted)",
    provider: "ollama",
    defaultModel: "qwen2.5-coder:latest",
    description: "Zero API cost, fully private local LLM running via Ollama / vLLM.",
    badge: "Local / Private",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "gemini",
    defaultModel: "gemini-2.5-flash",
    description: "Google Gemini with live Google Search grounding support.",
    badge: "Web Grounded",
  },
];

// Circuit breaker for rate-limited endpoints
const CIRCUIT_COOLDOWN_MS = 60_000;
const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 30_000;
const circuitCooldowns = new Map<string, number>();

function isCircuitOpen(key: string): boolean {
  return (circuitCooldowns.get(key) ?? 0) > Date.now();
}

function tripCircuit(key: string): void {
  circuitCooldowns.set(key, Date.now() + CIRCUIT_COOLDOWN_MS);
}

function resetCircuit(key: string): void {
  circuitCooldowns.delete(key);
}

/**
 * Resolves active provider and model settings from request options and environment variables.
 */
export function resolveProviderConfig(options?: LLMRequestOptions): {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
} {
  const provider =
    options?.provider ||
    (process.env.LLM_PROVIDER as LLMProvider) ||
    (process.env.DEEPSEEK_API_KEY ? "deepseek" : null) ||
    (process.env.OPENAI_API_KEY ? "openai-compatible" : null) ||
    (process.env.ANTHROPIC_API_KEY ? "anthropic" : null) ||
    (process.env.GEMINI_API_KEY ? "gemini" : null) ||
    (process.env.OLLAMA_BASE_URL ? "ollama" : null) ||
    "openai-compatible";

  const hasExplicitBaseUrl = Boolean(options?.baseUrl);
  const allowEnvironmentCredential = !hasExplicitBaseUrl || Boolean(options?.apiKey);
  let baseUrl = options?.baseUrl || "";
  let apiKey = options?.apiKey || "";
  let model = options?.model || "";

  switch (provider) {
    case "deepseek":
      baseUrl = baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
      apiKey = apiKey || (allowEnvironmentCredential ? process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "" : "");
      model = model || process.env.DEEPSEEK_MODEL || "deepseek-chat";
      break;

    case "anthropic":
      baseUrl = baseUrl || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
      apiKey = apiKey || (allowEnvironmentCredential ? process.env.ANTHROPIC_API_KEY || "" : "");
      model = model || process.env.ANTHROPIC_MODEL || "claude-3-7-sonnet-20250219";
      break;

    case "ollama":
      baseUrl = baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
      apiKey = apiKey || (allowEnvironmentCredential ? process.env.OLLAMA_API_KEY || "ollama" : "");
      model = model || process.env.OLLAMA_MODEL || "qwen2.5-coder:latest";
      break;

    case "gemini":
      baseUrl = baseUrl || process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
      apiKey = apiKey || (allowEnvironmentCredential ? process.env.GEMINI_API_KEY || "" : "");
      model = model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
      break;

    case "openai-compatible":
    case "custom":
    default:
      baseUrl =
        baseUrl ||
        process.env.OPENAI_BASE_URL ||
        process.env.LLM_BASE_URL ||
        "https://api.openai.com/v1";
      apiKey = apiKey || (allowEnvironmentCredential ? process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "" : "");
      model = model || process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4o-mini";
      break;
  }

  validateProviderBaseUrl(baseUrl);
  return { provider, model, apiKey, baseUrl };
}

function validateProviderBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("LLM provider base URL must be a valid absolute URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("LLM provider base URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("LLM provider base URL must not contain credentials.");
  }
}

/**
 * Universal LLM caller: routes request to the appropriate protocol handler.
 */
export async function callUniversalLLM(
  messages: LLMMessage[],
  options: LLMRequestOptions = {}
): Promise<LLMResponse> {
  const config = resolveProviderConfig(options);
  const targetModel = options.model || config.model;
  const circuitKey = `${config.provider}:${targetModel}`;

  if (isCircuitOpen(circuitKey)) {
    // If circuit is open, still attempt but without strict backoff
  }

  switch (config.provider) {
    case "anthropic":
      return callAnthropicMessages(messages, {
        ...options,
        model: targetModel,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });

    case "gemini":
      return callGeminiAPI(messages, {
        ...options,
        model: targetModel,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });

    case "deepseek":
    case "ollama":
    case "openai-compatible":
    case "custom":
    default:
      return callOpenAICompatibleChat(messages, {
        ...options,
        model: targetModel,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        provider: config.provider,
      });
  }
}

/**
 * OpenAI-Compatible Chat Completions caller (Standard /v1/chat/completions)
 */
async function callOpenAICompatibleChat(
  messages: LLMMessage[],
  options: LLMRequestOptions & { baseUrl: string; apiKey: string; model: string }
): Promise<LLMResponse> {
  const endpoint = options.baseUrl.replace(/\/+$/, "") + (options.baseUrl.endsWith("/chat/completions") ? "" : "/chat/completions");
  const circuitKey = `${options.provider || "openai"}:${options.model}`;

  const payload: Record<string, unknown> = {
    model: options.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: options.temperature ?? 0.7,
  };

  if (options.maxTokens) {
    payload.max_tokens = options.maxTokens;
  }

  if (options.responseFormat === "json_object" && !options.model.includes("reasoner")) {
    payload.response_format = { type: "json_object" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.apiKey) {
    headers["Authorization"] = `Bearer ${options.apiKey}`;
  }

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      }, options.timeoutMs);

      if (res.ok) {
        const data = await res.json();
        resetCircuit(circuitKey);

        const choice = data.choices?.[0];
        const content =
          choice?.message?.content ||
          choice?.delta?.content ||
          (typeof data.text === "string" ? data.text : "");

        const usage = {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        };

        return {
          text: content.trim(),
          usage,
          model: data.model || options.model,
          provider: options.provider || "openai-compatible",
        };
      }

      const errorText = await res.text();
      lastError = `HTTP ${res.status} from ${endpoint}: ${errorText.slice(0, 200)}`;

      if (res.status === 429) {
        tripCircuit(circuitKey);
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
      }

      throw new Error(lastError);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }

  throw new Error(`LLM call failed (${options.model}): ${lastError}`);
}

/**
 * Anthropic Claude Messages API caller (/v1/messages)
 */
async function callAnthropicMessages(
  messages: LLMMessage[],
  options: LLMRequestOptions & { baseUrl: string; apiKey: string; model: string }
): Promise<LLMResponse> {
  const endpoint = options.baseUrl.replace(/\/+$/, "") + (options.baseUrl.endsWith("/messages") ? "" : "/v1/messages");
  const circuitKey = `anthropic:${options.model}`;

  // Extract system messages for Anthropic system parameter
  const systemMessages = messages.filter((m) => m.role === "system");
  const systemPrompt = systemMessages.map((m) => m.content).join("\n\n");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  const formattedMessages = nonSystemMessages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const payload: Record<string, unknown> = {
    model: options.model,
    messages: formattedMessages.length > 0 ? formattedMessages : [{ role: "user", content: "Proceed." }],
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
  };

  if (systemPrompt) {
    payload.system = systemPrompt;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": options.apiKey,
    "anthropic-version": "2023-06-01",
  };

  try {
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }, options.timeoutMs);

    if (res.ok) {
      const data = await res.json();
      resetCircuit(circuitKey);

      let text = "";
      if (Array.isArray(data.content)) {
        text = data.content
          .filter((c: { type: string; text?: string }) => c.type === "text" && c.text)
          .map((c: { text: string }) => c.text)
          .join("\n");
      }

      const usage = {
        promptTokens: data.usage?.input_tokens ?? 0,
        completionTokens: data.usage?.output_tokens ?? 0,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      };

      return {
        text: text.trim(),
        usage,
        model: data.model || options.model,
        provider: "anthropic",
      };
    }

    const errorText = await res.text();
    throw new Error(`Anthropic HTTP ${res.status}: ${errorText.slice(0, 200)}`);
  } catch (err) {
    throw new Error(`Anthropic call failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Optional Google Generative Language API caller
 */
async function callGeminiAPI(
  messages: LLMMessage[],
  options: LLMRequestOptions & { baseUrl: string; apiKey: string; model: string }
): Promise<LLMResponse> {
  const model = options.model;
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/models/${model}:generateContent`;

  const systemMessages = messages.filter((m) => m.role === "system");
  const systemInstruction = systemMessages.map((m) => m.content).join("\n\n");
  const userMessages = messages.filter((m) => m.role !== "system");

  const contents = userMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const payload: Record<string, unknown> = {
    contents: contents.length > 0 ? contents : [{ role: "user", parts: [{ text: "Proceed." }] }],
  };

  if (systemInstruction) {
    payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  if (options.webSearch) {
    payload.tools = [{ google_search: {} }];
  }

  if (options.temperature !== undefined) {
    payload.generationConfig = { temperature: options.temperature };
  }

  try {
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": options.apiKey,
      },
      body: JSON.stringify(payload),
    }, options.timeoutMs);

    if (res.ok) {
      const data = await res.json();
      const cand = data.candidates?.[0];
      const parts = cand?.content?.parts ?? [];
      const text = parts
        .filter((p: { thought?: boolean; text?: string }) => !p.thought && p.text)
        .map((p: { text: string }) => p.text)
        .join("\n")
        .trim();

      const chunks = cand?.groundingMetadata?.groundingChunks ?? [];
      const sources: LLMSource[] = chunks
        .map((c: { web?: { uri?: string; title?: string } }) => c.web)
        .filter((w: { uri?: string } | undefined): w is { uri: string; title?: string } => !!w?.uri)
        .map((w: { uri: string; title?: string }) => ({
          title: w.title || w.uri || "source",
          uri: w.uri,
        }));

      const usage = {
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
      };

      return {
        text,
        usage,
        model,
        provider: "gemini",
        sources,
      };
    }

    const errorText = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${errorText.slice(0, 200)}`);
  } catch (err) {
    throw new Error(`Gemini API call failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Robust JSON extraction helper handling markdown code blocks, reasoning tags,
 * and trailing commas from any LLM provider.
 */
export function extractJsonFromResponse<T = Record<string, unknown>>(rawText: string): T {
  if (!rawText || !rawText.trim()) {
    return {} as T;
  }

  let cleaned = rawText.trim();

  // Strip <think>...</think> reasoning tags (e.g. DeepSeek R1 / Ollama)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Extract from markdown code fences ```json ... ``` or ``` ... ```
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    cleaned = codeBlockMatch[1].trim();
  }

  // Find outermost JSON object or array bounds
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
  let startIdx = -1;
  let endIdx = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
    endIdx = cleaned.lastIndexOf("}");
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    endIdx = cleaned.lastIndexOf("]");
  }

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    cleaned = cleaned.slice(startIdx, endIdx + 1);
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Attempt trailing comma cleanup
    try {
      const relaxed = cleaned.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(relaxed) as T;
    } catch {
      throw new Error(`Failed to parse JSON from LLM response. Snippet: ${rawText.slice(0, 200)}`);
    }
  }
}

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit,
  timeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS) ||
    DEFAULT_LLM_REQUEST_TIMEOUT_MS
): Promise<Response> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("LLM request timeout must be greater than zero.");
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`LLM request timed out after ${timeoutMs}ms.`)),
    timeoutMs
  );

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
