import { decodeUtf8Input, readBoundedRegularFile } from "./bounded-file";
import { validateEvidenceAnnotations } from "./evidence-annotations";

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
  let strictChangeCoverage = false;
  for (const { text } of taskContentLines(markdown)) {
    if (/^\s*<!--\s*agentship:\s*strict-change-coverage\s*-->\s*$/i.test(text)) {
      strictChangeCoverage = true;
    }
  }
  return { strictChangeCoverage };
}

/** Extract numbered requirements from a Markdown `## Requirements` section. */
export function parseTaskRequirements(markdown: string): TaskRequirement[] {
  assertTaskDocumentBounds(markdown);
  const requirements: TaskRequirement[] = [];
  const ids = new Set<string>();
  let inRequirements = false;
  let active: { requirement: TaskRequirement; contentIndent: number; bytes: number } | undefined;

  for (const { text: line, index } of taskContentLines(markdown)) {
    const whitespace = line.match(/^[ \t]*/)?.[0] ?? "";
    const indent = indentationColumn(whitespace);
    if (inRequirements && active && line.trim() && indent >= active.contentIndent) {
      const continuation = line.trim();
      const bytes = active.bytes + 1 + Buffer.byteLength(continuation);
      if (bytes > MAX_REQUIREMENT_BYTES) {
        throw new Error(`Task requirement '${active.requirement.id}' must contain at most ${MAX_REQUIREMENT_BYTES} bytes of text.`);
      }
      active.requirement.text += `\n${continuation}`;
      active.bytes = bytes;
      continue;
    }
    const heading = indent <= 3 ? line.trimStart().match(/^(#{1,6})\s+(.+?)\s*$/) : null;
    if (heading) {
      active = undefined;
      const level = heading[1].length;
      if (level <= 2) {
        inRequirements = heading[2].trim().toLowerCase() === "requirements";
      }
      continue;
    }

    if (!inRequirements) continue;
    const match = indent <= 3 ? line.match(/^([ \t]*)(\d+)[.)]([ \t]+)(.+?)\s*$/) : null;
    if (!match) {
      if (active && line.trim() && indent > 0) {
        throw new Error(`Task continuation for '${active.requirement.id}' must align with its content column (${active.contentIndent} spaces).`);
      }
      if (line.trim()) active = undefined;
      continue;
    }
    const number = Number(match[2]);
    if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_REQUIREMENT_NUMBER) {
      throw new Error(
        `Task requirement number must be between 1 and ${MAX_REQUIREMENT_NUMBER}.`
      );
    }
    const id = `R${number}`;
    if (ids.has(id)) throw new Error(`Task requirement '${id}' is duplicated.`);
    const requiresConfirmation = match[4].startsWith("[confirm]");
    const text = requiresConfirmation
      ? match[4].slice("[confirm]".length).trim()
      : match[4];
    if (!text || Buffer.byteLength(text) > MAX_REQUIREMENT_BYTES) {
      throw new Error(
        `Task requirement '${id}' must contain at most ${MAX_REQUIREMENT_BYTES} bytes of text.`
      );
    }
    if (requirements.length >= MAX_TASK_REQUIREMENTS) {
      throw new Error(`Task document exceeds ${MAX_TASK_REQUIREMENTS} requirements.`);
    }
    ids.add(id);
    const requirement: TaskRequirement = {
      id,
      text,
      line: index + 1,
      confirmation: requiresConfirmation ? "required" : "not_required",
      confirmationBasis: requiresConfirmation ? ["task_marker"] : [],
    };
    requirements.push(requirement);
    active = {
      requirement,
      contentIndent: indentationColumn(match[3], indent + match[2].length + 1),
      bytes: Buffer.byteLength(text),
    };
  }

  for (const requirement of requirements) {
    try { validateEvidenceAnnotations(requirement.text); }
    catch (error) { throw new Error(`Task requirement '${requirement.id}': ${error instanceof Error ? error.message : "invalid evidence annotations"}`); }
  }
  return requirements;
}

export function assertTaskDocumentBounds(markdown: string): void {
  if (Buffer.byteLength(markdown) > MAX_TASK_DOCUMENT_BYTES) {
    throw new Error(`Task document exceeds ${MAX_TASK_DOCUMENT_BYTES} bytes.`);
  }
}

export async function readBoundedTaskDocument(filePath: string): Promise<Buffer> {
  const source = await readBoundedRegularFile(
    filePath,
    "Task document",
    MAX_TASK_DOCUMENT_BYTES
  );
  decodeUtf8Input(source, "Task document");
  return source;
}

function indentationColumn(whitespace: string, column = 0): number {
  for (const character of whitespace) column += character === "\t" ? 4 - (column % 4) : 1;
  return column;
}

function* taskContentLines(
  markdown: string
): Generator<{ text: string; index: number }> {
  let fence: { character: "`" | "~"; length: number; line: number } | undefined;
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
        line: index + 1,
      };
      continue;
    }
    yield { text, index };
  }
  if (fence) {
    throw new Error(`Unclosed task code fence at line ${fence.line}; close the fence before review.`);
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
