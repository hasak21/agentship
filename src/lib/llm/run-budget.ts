import type { LLMMessage } from "./types";

export interface LLMRunBudgetLimits {
  maxCalls: number;
  maxInputBytes: number;
  maxReservedOutputTokens: number;
  maxReportedTokens: number;
  maxDurationMs: number;
}

export interface LLMRunBudgetSnapshot {
  limits: LLMRunBudgetLimits;
  calls: number;
  inputBytes: number;
  reservedOutputTokens: number;
  reportedTokens: number;
  elapsedMs: number;
  exhausted: boolean;
}

export const DEFAULT_LLM_RUN_BUDGET: LLMRunBudgetLimits = {
  maxCalls: 20,
  maxInputBytes: 4 * 1024 * 1024,
  maxReservedOutputTokens: 65_536,
  maxReportedTokens: 100_000,
  maxDurationMs: 180_000,
};

export class LLMRunBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMRunBudgetError";
  }
}

export class LLMRunBudget {
  private readonly startedAt: number;
  private calls = 0;
  private inputBytes = 0;
  private reservedOutputTokens = 0;
  private reportedTokens = 0;
  private exhausted = false;

  constructor(
    readonly limits: LLMRunBudgetLimits = DEFAULT_LLM_RUN_BUDGET,
    private readonly now: () => number = () => performance.now()
  ) {
    validateLimits(limits);
    this.startedAt = now();
  }

  claim(messages: readonly LLMMessage[], outputTokens: number): number {
    const inputBytes = messages.reduce(
      (total, message) => total + Buffer.byteLength(message.content),
      0
    );
    if (!Number.isSafeInteger(outputTokens) || outputTokens <= 0) {
      throw new LLMRunBudgetError(
        "LLM run budget requires a positive integer output-token reservation."
      );
    }
    const remainingMs = this.remainingDurationMs();
    const prospectiveCalls = this.calls + 1;
    const prospectiveInputBytes = this.inputBytes + inputBytes;
    const prospectiveOutputTokens =
      this.reservedOutputTokens + outputTokens;
    if (this.reportedTokens >= this.limits.maxReportedTokens) {
      this.fail(
        `LLM run reported-token budget exhausted (${this.reportedTokens}/${this.limits.maxReportedTokens}).`
      );
    }
    if (prospectiveCalls > this.limits.maxCalls) {
      this.fail(`LLM run call budget exceeded (${prospectiveCalls}/${this.limits.maxCalls}).`);
    }
    if (prospectiveInputBytes > this.limits.maxInputBytes) {
      this.fail(
        `LLM run input-byte budget exceeded (${prospectiveInputBytes}/${this.limits.maxInputBytes}).`
      );
    }
    if (prospectiveOutputTokens > this.limits.maxReservedOutputTokens) {
      this.fail(
        `LLM run reserved-output-token budget exceeded (${prospectiveOutputTokens}/${this.limits.maxReservedOutputTokens}).`
      );
    }

    this.calls = prospectiveCalls;
    this.inputBytes = prospectiveInputBytes;
    this.reservedOutputTokens = prospectiveOutputTokens;
    return remainingMs;
  }

  recordReportedTokens(tokens: number): void {
    if (!Number.isSafeInteger(tokens) || tokens < 0) return;
    this.reportedTokens = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.reportedTokens + tokens
    );
    if (this.reportedTokens >= this.limits.maxReportedTokens) {
      this.exhausted = true;
    }
  }

  snapshot(): LLMRunBudgetSnapshot {
    const elapsedMs = Math.max(0, Math.floor(this.now() - this.startedAt));
    return {
      limits: { ...this.limits },
      calls: this.calls,
      inputBytes: this.inputBytes,
      reservedOutputTokens: this.reservedOutputTokens,
      reportedTokens: this.reportedTokens,
      elapsedMs,
      exhausted:
        this.exhausted || elapsedMs >= this.limits.maxDurationMs,
    };
  }

  remainingDurationMs(): number {
    const remaining = Math.floor(
      this.limits.maxDurationMs - (this.now() - this.startedAt)
    );
    if (remaining <= 0) {
      this.fail(
        `LLM run wall-clock budget exhausted (${this.limits.maxDurationMs}ms).`
      );
    }
    return remaining;
  }

  private fail(message: string): never {
    this.exhausted = true;
    throw new LLMRunBudgetError(message);
  }
}

export function createDefaultLLMRunBudget(): LLMRunBudget {
  return new LLMRunBudget({
    maxCalls: readBoundedInteger("AGENTSHIP_LLM_MAX_CALLS", 20, 1, 64),
    maxInputBytes: readBoundedInteger(
      "AGENTSHIP_LLM_MAX_INPUT_BYTES",
      4 * 1024 * 1024,
      1,
      64 * 1024 * 1024
    ),
    maxReservedOutputTokens: readBoundedInteger(
      "AGENTSHIP_LLM_MAX_RESERVED_OUTPUT_TOKENS",
      65_536,
      1,
      1_048_576
    ),
    maxReportedTokens: readBoundedInteger(
      "AGENTSHIP_LLM_MAX_REPORTED_TOKENS",
      100_000,
      1,
      2_000_000
    ),
    maxDurationMs: readBoundedInteger(
      "AGENTSHIP_LLM_RUN_TIMEOUT_MS",
      180_000,
      1,
      600_000
    ),
  });
}

function readBoundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function validateLimits(limits: LLMRunBudgetLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`LLM run budget ${name} must be a positive integer.`);
    }
  }
}
