import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/research/route";

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/research", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function events(response: Response): Promise<Array<Record<string, unknown>>> {
  return (await response.text())
    .split("\n\n")
    .filter((entry) => entry.startsWith("data: "))
    .map((entry) => JSON.parse(entry.slice("data: ".length)) as Record<string, unknown>);
}

test("research stream reports aggregate LLM budget evidence", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = (async () =>
    Response.json({
      model: "test-model",
      choices: [{ message: { content: "bounded answer" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })) as typeof fetch;

  try {
    const streamed = await events(
      await POST(
        request({
          question: "Give a concise answer.",
          pattern: "single",
          provider: "openai-compatible",
          model: "test-model",
        })
      )
    );
    const budgets = streamed.filter((event) => event.type === "budget");
    assert.equal(budgets.length, 2);
    assert.equal(budgets[0]?.phase, "start");
    assert.equal(budgets[1]?.phase, "final");
    assert.equal(budgets[1]?.calls, 1);
    assert.equal(budgets[1]?.reservedOutputTokens, 4096);
    assert.equal(budgets[1]?.reportedTokens, 2);
    assert.equal(budgets[1]?.exhausted, false);
    assert.equal(streamed.at(-1)?.type, "done");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("research fan-out stops making provider calls when the run budget is exhausted", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  const previousCalls = process.env.AGENTSHIP_LLM_MAX_CALLS;
  process.env.OPENAI_API_KEY = "test-key";
  process.env.AGENTSHIP_LLM_MAX_CALLS = "1";
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches++;
    return Response.json({
      model: "test-model",
      choices: [{ message: { content: '["Only subtask"]' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }) as typeof fetch;

  try {
    const streamed = await events(
      await POST(
        request({
          question: "Analyze this task.",
          pattern: "orchestrator",
          provider: "openai-compatible",
          model: "test-model",
        })
      )
    );
    const finalBudget = streamed.find(
      (event) => event.type === "budget" && event.phase === "final"
    );
    assert.equal(fetches, 1);
    assert.equal(finalBudget?.calls, 1);
    assert.equal(finalBudget?.exhausted, true);
    assert.ok(
      streamed.some(
        (event) =>
          event.type === "node_done" &&
          event.failed === true &&
          String(event.result).includes("call budget exceeded")
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousCalls === undefined) delete process.env.AGENTSHIP_LLM_MAX_CALLS;
    else process.env.AGENTSHIP_LLM_MAX_CALLS = previousCalls;
  }
});
