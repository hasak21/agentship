import test from "node:test";
import assert from "node:assert/strict";
import { callUniversalLLM, extractJsonFromResponse, fetchWithTimeout, resolveProviderConfig, UNIVERSAL_MODEL_PRESETS } from "../src/lib/llm/client";
import { parsePublicLLMOptions, PublicLLMInputError } from "../src/lib/llm/public-options";

test("UNIVERSAL_MODEL_PRESETS contains essential providers", () => {
  const ids = UNIVERSAL_MODEL_PRESETS.map((p) => p.id);
  assert.ok(ids.includes("deepseek-v4-flash"));
  assert.ok(ids.includes("deepseek-v4-pro"));
  assert.ok(ids.includes("claude-opus-5"));
  assert.ok(ids.includes("claude-sonnet-5"));
  assert.ok(ids.includes("gpt-6-astra"));
  assert.ok(ids.includes("ollama-local"));
  assert.ok(ids.includes("gemini-3-8-flash"));
});

test("modern OpenAI models omit unsupported sampling and use completion token limits", async () => {
  const originalFetch = globalThis.fetch;
  let payload: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    payload = JSON.parse(String(init?.body));
    return Response.json({
      model: "gpt-6-astra",
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }) as typeof fetch;

  try {
    await callUniversalLLM(
      [{ role: "user", content: "Review this." }],
      {
        provider: "openai-compatible",
        model: "gpt-6-astra",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-key",
        temperature: 0.2,
        maxTokens: 512,
      }
    );
    assert.equal(payload?.temperature, undefined);
    assert.equal(payload?.max_tokens, undefined);
    assert.equal(payload?.max_completion_tokens, 512);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generic OpenAI-compatible endpoints retain sampling and max_tokens", async () => {
  const originalFetch = globalThis.fetch;
  let payload: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    payload = JSON.parse(String(init?.body));
    return Response.json({
      model: "custom-model",
      choices: [{ message: { content: "ok" } }],
    });
  }) as typeof fetch;

  try {
    await callUniversalLLM(
      [{ role: "user", content: "Review this." }],
      {
        provider: "openai-compatible",
        model: "custom-model",
        baseUrl: "https://compatible.example/v1",
        apiKey: "test-key",
        temperature: 0.2,
        maxTokens: 512,
      }
    );
    assert.equal(payload?.temperature, 0.2);
    assert.equal(payload?.max_tokens, 512);
    assert.equal(payload?.max_completion_tokens, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveProviderConfig handles default fallback gracefully", () => {
  const config = resolveProviderConfig();
  assert.ok(config.provider);
  assert.ok(config.model);
});

test("provider defaults use the current verified model catalog", () => {
  assert.equal(
    resolveProviderConfig({ provider: "deepseek", apiKey: "test" }).model,
    "deepseek-flash"
  );
  assert.equal(
    resolveProviderConfig({ provider: "anthropic", apiKey: "test" }).model,
    "claude-sonnet-5"
  );
  assert.equal(
    resolveProviderConfig({ provider: "openai-compatible", apiKey: "test" }).model,
    "gpt-6-astra"
  );
  assert.equal(
    resolveProviderConfig({ provider: "gemini", apiKey: "test" }).model,
    "gemini-3.8-flash"
  );
  assert.equal(
    resolveProviderConfig({ provider: "ollama", apiKey: "test" }).model,
    "qwen3-coder:30b"
  );
});

test("extractJsonFromResponse extracts clean JSON from markdown code blocks", () => {
  const input = "Here is the result:\n```json\n{\n  \"score\": 95,\n  \"passed\": true\n}\n```\nHope this helps!";
  const result = extractJsonFromResponse<{ score: number; passed: boolean }>(input);
  assert.equal(result.score, 95);
  assert.equal(result.passed, true);
});

test("extractJsonFromResponse strips <think> tags from reasoning models", () => {
  const input = "<think>\nThinking about the code logic and security vulnerabilities...\n</think>\n```json\n{\n  \"passed\": false,\n  \"overallScore\": 65\n}\n```";
  const result = extractJsonFromResponse<{ passed: boolean; overallScore: number }>(input);
  assert.equal(result.passed, false);
  assert.equal(result.overallScore, 65);
});

test("extractJsonFromResponse repairs trailing commas in loose JSON", () => {
  const input = "{\n  \"name\": \"test\",\n  \"items\": [1, 2, 3,]\n}";
  const result = extractJsonFromResponse<{ name: string; items: number[] }>(input);
  assert.equal(result.name, "test");
  assert.deepEqual(result.items, [1, 2, 3]);
});

test("an explicit provider URL never inherits a server environment credential", () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "server-secret";
  try {
    const config = resolveProviderConfig({
      provider: "openai-compatible",
      baseUrl: "https://untrusted.example/v1",
    });
    assert.equal(config.apiKey, "");
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("public LLM options reject credentials and network destinations", () => {
  assert.throws(
    () => parsePublicLLMOptions({ baseUrl: "https://untrusted.example/v1" }),
    PublicLLMInputError
  );
  assert.throws(
    () => parsePublicLLMOptions({ apiKey: "request-secret" }),
    PublicLLMInputError
  );
});

test("public LLM options accept only supported provider selection", () => {
  assert.deepEqual(
    parsePublicLLMOptions({ provider: "deepseek", model: "deepseek-flash" }),
    { provider: "deepseek", model: "deepseek-flash" }
  );
  assert.throws(
    () => parsePublicLLMOptions({ provider: "custom" }),
    PublicLLMInputError
  );
});

test("provider fetch timeout aborts the underlying request", async () => {
  const originalFetch = globalThis.fetch;
  let observedAbort = false;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        observedAbort = true;
        reject(init.signal?.reason);
      });
    })) as typeof fetch;

  try {
    await assert.rejects(
      () => fetchWithTimeout("https://provider.invalid", { method: "POST" }, 20),
      /timed out after 20ms/
    );
    assert.equal(observedAbort, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
