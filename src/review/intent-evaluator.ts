import { mapRequirementsToChangedFiles } from "./requirement-mapper";
import type { RequirementMapping } from "./requirement-mapper";
import type { CheckStatus } from "./types";

export interface IntentFixtureCase {
  id: string;
  requirement: string;
  changedFiles: string[];
  checks?: Array<{ name: string; status: CheckStatus }>;
  diff?: string;
  expectedStatus: RequirementMapping["status"];
}

export interface IntentMetrics {
  cases: number;
  correct: number;
  accuracy: number;
  missingPrecision: number;
  missingRecall: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface SeededOmissionCase {
  id: string;
  category: string;
  requirement: string;
  changedFiles: string[];
  checks?: Array<{ name: string; status: CheckStatus }>;
  diff?: string;
  omissionExpected: boolean;
  rationale: string;
}

export interface SeededOmissionMetrics {
  cases: number;
  truePositives: number;
  trueNegatives: number;
  falsePositives: number;
  falseNegatives: number;
  accuracy: number;
  precision: number;
  recall: number;
  falsePositiveRate: number;
}

export interface SeededOmissionResult {
  id: string;
  category: string;
  omissionExpected: boolean;
  omissionDetected: boolean;
  mappingStatus: RequirementMapping["status"];
  correct: boolean;
}

export function evaluateIntentFixtures(cases: IntentFixtureCase[]): IntentMetrics {
  let correct = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (const fixture of cases) {
    const [mapping] = mapRequirementsToChangedFiles(
      [
        {
          id: fixture.id,
          text: fixture.requirement,
          line: 1,
          confirmation: "not_required",
          confirmationBasis: [],
        },
      ],
      fixture.changedFiles,
      fixture.checks,
      fixture.diff
    );
    if (mapping.status === fixture.expectedStatus) correct++;
    if (isMissing(mapping.status) && isMissing(fixture.expectedStatus)) {
      truePositive++;
    } else if (isMissing(mapping.status)) {
      falsePositive++;
    } else if (isMissing(fixture.expectedStatus)) {
      falseNegative++;
    }
  }

  return {
    cases: cases.length,
    correct,
    accuracy: ratio(correct, cases.length),
    missingPrecision: ratio(truePositive, truePositive + falsePositive),
    missingRecall: ratio(truePositive, truePositive + falseNegative),
    falsePositives: falsePositive,
    falseNegatives: falseNegative,
  };
}

export function evaluateSeededOmissions(
  cases: SeededOmissionCase[]
): SeededOmissionMetrics {
  let truePositives = 0;
  let trueNegatives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const result of evaluateSeededOmissionCases(cases)) {
    if (result.omissionDetected && result.omissionExpected) truePositives++;
    else if (result.omissionDetected) falsePositives++;
    else if (result.omissionExpected) falseNegatives++;
    else trueNegatives++;
  }

  return {
    cases: cases.length,
    truePositives,
    trueNegatives,
    falsePositives,
    falseNegatives,
    accuracy: ratio(truePositives + trueNegatives, cases.length),
    precision: ratio(truePositives, truePositives + falsePositives),
    recall: ratio(truePositives, truePositives + falseNegatives),
    falsePositiveRate: ratio(falsePositives, falsePositives + trueNegatives),
  };
}

export function evaluateSeededOmissionCases(
  cases: SeededOmissionCase[]
): SeededOmissionResult[] {
  return cases.map((fixture) => {
    const [mapping] = mapRequirementsToChangedFiles(
      [
        {
          id: fixture.id,
          text: fixture.requirement,
          line: 1,
          confirmation: "not_required",
          confirmationBasis: [],
        },
      ],
      fixture.changedFiles,
      fixture.checks,
      fixture.diff
    );
    const omissionDetected = isMissing(mapping.status);
    return {
      id: fixture.id,
      category: fixture.category,
      omissionExpected: fixture.omissionExpected,
      omissionDetected,
      mappingStatus: mapping.status,
      correct: omissionDetected === fixture.omissionExpected,
    };
  });
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function isMissing(status: RequirementMapping["status"]): boolean {
  return status === "missing" || status === "inferred_missing";
}
