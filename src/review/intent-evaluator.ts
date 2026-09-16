import { mapRequirementsToChangedFiles } from "./requirement-mapper";
import type { RequirementMapping } from "./requirement-mapper";

export interface IntentFixtureCase {
  id: string;
  requirement: string;
  changedFiles: string[];
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
        },
      ],
      fixture.changedFiles
    );
    if (mapping.status === fixture.expectedStatus) correct++;
    if (mapping.status === "missing" && fixture.expectedStatus === "missing") {
      truePositive++;
    } else if (mapping.status === "missing") {
      falsePositive++;
    } else if (fixture.expectedStatus === "missing") {
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

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}
