import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonFromResponse, resolveProviderConfig, UNIVERSAL_MODEL_PRESETS } from "../src/lib/llm/client";

test("UNIVERSAL_MODEL_PRESETS contains essential providers", () => {
  const ids = UNIVERSAL_MODEL_PRESETS.map((p) => p.id);
  assert.ok(ids.includes("deepseek-v3"));
  assert.ok(ids.includes("deepseek-r1"));
  assert.ok(ids.includes("claude-3-7-sonnet"));
  assert.ok(ids.includes("gpt-4o"));
  assert.ok(ids.includes("ollama-local"));
});

test("resolveProviderConfig handles default fallback gracefully", () => {
  const config = resolveProviderConfig();
  assert.ok(config.provider);
  assert.ok(config.model);
});

test("extractJsonFromResponse extracts clean JSON from markdown code blocks", () => {
  const input = "Here is the result:\n```json\n{\n  \"score\": 95,\n  \"passed\": true\n}\n```\nHope this helps!";
  const result = extractJsonFromResponse<{ score: number; passed: boolean }>(input);
  assert.equal(result.score, 95);
  assert.equal(result.passed, true);
});

test("extractJsonFromResponse strips <think> tags from reasoning models (e.g. DeepSeek R1)", () => {
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
