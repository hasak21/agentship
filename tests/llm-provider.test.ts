import test from "node:test";
import assert from "node:assert/strict";
import {
  callUniversalLLM,
  DEFAULT_LLM_MAX_TOKENS,
  extractJsonFromResponse,
  fetchWithTimeout,
  readBoundedResponseText,
  resolveProviderConfig,
  UNIVERSAL_MODEL_PRESETS,
} from "../src/lib/llm/client";
import { parsePublicLLMOptions, PublicLLMInputError } from "../src/lib/llm/public-options";
import {
  DEFAULT_LLM_RUN_BUDGET,
  LLMRunBudget,
  LLMRunBudgetError,
} from "../src/lib/llm/run-budget";

test("every provider reserves actual transport calls before fetching", async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches++;
    return Response.json({
      choices: [{ message: { content: "ok" } }],
      content: [{ type: "text", text: "ok" }],
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
    });
  }) as typeof fetch;
  try {
    for (const provider of ["openai-compatible", "anthropic", "gemini"] as const) {
      const runBudget = new LLMRunBudget({
        ...DEFAULT_LLM_RUN_BUDGET,
        maxCalls: 1,
      });
      const options = {
        provider,
        model: "test-model",
        baseUrl: "https://provider.example/v1",
        apiKey: "test-key",
        runBudget,
      };
      const messages = [{ role: "user" as const, content: "review" }];
      const before = fetches;
      await callUniversalLLM(messages, options);
      await assert.rejects(callUniversalLLM(messages, options), LLMRunBudgetError);
      assert.equal(fetches - before, 1, provider);
      assert.equal(runBudget.snapshot().calls, 1);
      assert.equal(runBudget.snapshot().inputBytes, 6);
      assert.equal(runBudget.snapshot().reservedOutputTokens, 4096);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider retry backoff stops at the shared run deadline", async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches++;
    return new Response("unavailable", { status: 503 });
  }) as typeof fetch;
  const runBudget = new LLMRunBudget({
    ...DEFAULT_LLM_RUN_BUDGET,
    maxDurationMs: 40,
  });
  try {
    await assert.rejects(
      callUniversalLLM([{ role: "user", content: "review" }], {
        provider: "openai-compatible",
        model: "test-model",
        baseUrl: "https://provider.example/v1",
        apiKey: "test-key",
        runBudget,
      }),
      LLMRunBudgetError
    );
    assert.equal(fetches, 1);
    assert.equal(runBudget.snapshot().exhausted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test("provider requests apply a bounded default output token limit", async () => {
  const originalFetch = globalThis.fetch;
  const payloads: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({
      model: "test-model",
      choices: [{ message: { content: "ok" } }],
    });
  }) as typeof fetch;

  try {
    await callUniversalLLM([{ role: "user", content: "Review this." }], {
      provider: "openai-compatible",
      model: "test-model",
      baseUrl: "https://compatible.example/v1",
      apiKey: "test-key",
    });
    assert.equal(payloads[0]?.max_tokens, DEFAULT_LLM_MAX_TOKENS);
    await callUniversalLLM([{ role: "user", content: "Review this." }], {
      provider: "anthropic",
      model: "test-model",
      baseUrl: "https://anthropic.example",
      apiKey: "test-key",
    });
    assert.equal(payloads[1]?.max_tokens, DEFAULT_LLM_MAX_TOKENS);
    await callUniversalLLM([{ role: "user", content: "Review this." }], {
      provider: "gemini",
      model: "test-model",
      baseUrl: "https://gemini.example/v1beta",
      apiKey: "test-key",
    });
    assert.deepEqual(payloads[2]?.generationConfig, {
      maxOutputTokens: DEFAULT_LLM_MAX_TOKENS,
    });
    await assert.rejects(
      callUniversalLLM([{ role: "user", content: "Review this." }], {
        provider: "openai-compatible",
        model: "test-model",
        baseUrl: "https://compatible.example/v1",
        apiKey: "test-key",
        maxTokens: 0,
      }),
      /integer between 1 and 65536/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bounded provider response reader rejects declared and streamed excess", async () => {
  await assert.rejects(
    readBoundedResponseText(
      new Response("small", { headers: { "content-length": "100" } }),
      10
    ),
    /exceeds 10 bytes/
  );

  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("123456"));
      controller.enqueue(new TextEncoder().encode("789012"));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readBoundedResponseText(new Response(stream), 10),
    /exceeds 10 bytes/
  );
  assert.equal(cancelled, true);
});

test("bounded provider response reader accepts exact UTF-8 and rejects malformed bytes", async () => {
  assert.equal(await readBoundedResponseText(new Response("four"), 4), "four");
  await assert.rejects(
    readBoundedResponseText(new Response(new Uint8Array([0xff])), 1),
    /not valid UTF-8/
  );
});

test("provider timeout remains active while the response body is consumed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () =>
            controller.error(init.signal?.reason)
          );
        },
        pull() {
          // Deliberately never produce or close the body.
        },
      })
    )) as typeof fetch;

  try {
    await assert.rejects(
      callUniversalLLM([{ role: "user", content: "Review this." }], {
        provider: "anthropic",
        model: "test-model",
        baseUrl: "https://anthropic.example",
        apiKey: "test-key",
        timeoutMs: 20,
      }),
      /timed out after 20ms/
    );
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
