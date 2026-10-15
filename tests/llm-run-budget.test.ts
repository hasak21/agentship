import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultLLMRunBudget,
  LLMRunBudget,
  LLMRunBudgetError,
} from "../src/lib/llm/run-budget";

const limits = {
  maxCalls: 2,
  maxInputBytes: 10,
  maxReservedOutputTokens: 8,
  maxReportedTokens: 12,
  maxDurationMs: 100,
};

test("LLM run budget reserves calls, prompt bytes, and output tokens atomically", () => {
  let now = 0;
  const budget = new LLMRunBudget(limits, () => now);
  assert.equal(
    budget.claim([{ role: "user", content: "four" }], 4),
    100
  );
  now = 5;
  assert.equal(
    budget.claim([{ role: "user", content: "six!!!" }], 4),
    95
  );
  assert.deepEqual(budget.snapshot(), {
    limits,
    calls: 2,
    inputBytes: 10,
    reservedOutputTokens: 8,
    reportedTokens: 0,
    elapsedMs: 5,
    exhausted: false,
  });
  assert.throws(
    () => budget.claim([{ role: "user", content: "x" }], 1),
    LLMRunBudgetError
  );
  assert.equal(budget.snapshot().calls, 2);
  assert.equal(budget.snapshot().exhausted, true);
});

test("LLM run budget blocks subsequent calls after reported-token exhaustion", () => {
  const budget = new LLMRunBudget(limits, () => 0);
  budget.claim([{ role: "user", content: "a" }], 1);
  budget.recordReportedTokens(12);
  assert.equal(budget.snapshot().reportedTokens, 12);
  assert.throws(
    () => budget.claim([{ role: "user", content: "b" }], 1),
    /reported-token budget exhausted/
  );
});

test("LLM run budget clamps calls to the remaining wall-clock lifetime", () => {
  let now = 10;
  const budget = new LLMRunBudget(limits, () => now);
  now = 109;
  assert.equal(budget.claim([{ role: "user", content: "a" }], 1), 1);
  now = 110;
  assert.throws(
    () => budget.claim([{ role: "user", content: "b" }], 1),
    /wall-clock budget exhausted/
  );
});

test("environment run budgets are bounded and fail closed", () => {
  const previous = process.env.AGENTSHIP_LLM_MAX_CALLS;
  process.env.AGENTSHIP_LLM_MAX_CALLS = "0";
  try {
    assert.throws(createDefaultLLMRunBudget, /integer between 1 and 64/);
  } finally {
    if (previous === undefined) delete process.env.AGENTSHIP_LLM_MAX_CALLS;
    else process.env.AGENTSHIP_LLM_MAX_CALLS = previous;
  }
});
