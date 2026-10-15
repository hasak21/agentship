import { readBoundedRegularFile } from "./bounded-file";

export interface TaskRequirement {
  id: string;
  text: string;
  line: number;
  confirmation: "not_required" | "required" | "confirmed";
  confirmationBasis: Array<"task_marker" | "protected_path">;
}

export interface TaskOptions {
  strictChangeCoverage: boolean;
}

export const MAX_TASK_DOCUMENT_BYTES = 256 * 1024;
export const MAX_TASK_REQUIREMENTS = 256;
const MAX_REQUIREMENT_BYTES = 16 * 1024;
const MAX_REQUIREMENT_NUMBER = 9_999;

export function parseTaskOptions(markdown: string): TaskOptions {
  assertTaskDocumentBounds(markdown);
  for (const { text } of taskContentLines(markdown)) {
    if (/^\s*<!--\s*agentship:\s*strict-change-coverage\s*-->\s*$/i.test(text)) {
      return { strictChangeCoverage: true };
    }
  }
  return { strictChangeCoverage: false };
}

/** Extract numbered requirements from a Markdown `## Requirements` section. */
export function parseTaskRequirements(markdown: string): TaskRequirement[] {
  assertTaskDocumentBounds(markdown);
  const requirements: TaskRequirement[] = [];
  const ids = new Set<string>();
  let inRequirements = false;

  for (const { text: line, index } of taskContentLines(markdown)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      const level = line.match(/^#+/)?.[0].length ?? 0;
      if (level <= 2) {
        inRequirements = heading[1].trim().toLowerCase() === "requirements";
      }
      continue;
    }

    if (!inRequirements) continue;
    const match = line.match(/^\s*(\d+)[.)]\s+(.+?)\s*$/);
    if (!match) continue;
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_REQUIREMENT_NUMBER) {
      throw new Error(
        `Task requirement number must be between 1 and ${MAX_REQUIREMENT_NUMBER}.`
      );
    }
    const id = `R${number}`;
    if (ids.has(id)) throw new Error(`Task requirement '${id}' is duplicated.`);
    const requiresConfirmation = match[2].startsWith("[confirm]");
    const text = requiresConfirmation
      ? match[2].slice("[confirm]".length).trim()
      : match[2];
    if (!text || Buffer.byteLength(text) > MAX_REQUIREMENT_BYTES) {
      throw new Error(
        `Task requirement '${id}' must contain at most ${MAX_REQUIREMENT_BYTES} bytes of text.`
      );
    }
    if (requirements.length >= MAX_TASK_REQUIREMENTS) {
      throw new Error(`Task document exceeds ${MAX_TASK_REQUIREMENTS} requirements.`);
    }
    ids.add(id);
    requirements.push({
      id,
      text,
      line: index + 1,
      confirmation: requiresConfirmation ? "required" : "not_required",
      confirmationBasis: requiresConfirmation ? ["task_marker"] : [],
    });
  }

  return requirements;
}

export function assertTaskDocumentBounds(markdown: string): void {
  if (Buffer.byteLength(markdown) > MAX_TASK_DOCUMENT_BYTES) {
    throw new Error(`Task document exceeds ${MAX_TASK_DOCUMENT_BYTES} bytes.`);
  }
}

export async function readBoundedTaskDocument(filePath: string): Promise<Buffer> {
  return readBoundedRegularFile(
    filePath,
    "Task document",
    MAX_TASK_DOCUMENT_BYTES
  );
}

function* taskContentLines(
  markdown: string
): Generator<{ text: string; index: number }> {
  let fence: { character: "`" | "~"; length: number } | undefined;
  for (const [index, text] of markdown.split(/\r?\n/).entries()) {
    if (fence) {
      const closing = text.match(/^\s*(`{3,}|~{3,})\s*$/)?.[1];
      if (
        closing &&
        closing[0] === fence.character &&
        closing.length >= fence.length
      ) {
        fence = undefined;
      }
      continue;
    }
    const opening = text.match(/^\s*(`{3,}|~{3,})(?:[^`~].*)?$/)?.[1];
    if (opening) {
      fence = {
        character: opening[0] as "`" | "~",
        length: opening.length,
      };
      continue;
    }
    yield { text, index };
  }
}

export function applyRequirementConfirmations(
  requirements: TaskRequirement[],
  confirmedIds: string[],
  protectedRequirementIds: string[] = []
): TaskRequirement[] {
  const knownIds = new Set(requirements.map((requirement) => requirement.id));
  const unknown = confirmedIds.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown requirement confirmation: ${unknown.join(", ")}.`);
  }
  const confirmed = new Set(confirmedIds);
  const protectedIds = new Set(protectedRequirementIds);
  return requirements.map((requirement) => ({
    ...requirement,
    confirmationBasis: [
      ...new Set([
        ...requirement.confirmationBasis,
        ...(protectedIds.has(requirement.id) ? (["protected_path"] as const) : []),
      ]),
    ],
    confirmation:
      requirement.confirmationBasis.length > 0 || protectedIds.has(requirement.id)
        ? confirmed.has(requirement.id)
          ? "confirmed"
          : "required"
        : "not_required",
  }));
}
