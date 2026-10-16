export interface SymbolReference { path: string; symbol: string }
type Kind = "change" | "check" | "symbol";

function values(text: string, kind: Kind): string[] {
  const result: string[] = [];
  const runs = [...text.matchAll(/`+/g)];
  for (let cursor = 0; cursor < runs.length; cursor++) {
    const match = runs[cursor];
    let backslashes = 0;
    for (let index = match.index! - 1; index >= 0 && text[index] === "\\"; index--) backslashes++;
    if (backslashes % 2) continue;
    const start = match.index! + match[0].length;
    const declared = match[0].length === 1 && text.startsWith(`${kind}:`, start);
    let closing = cursor + 1;
    while (closing < runs.length && runs[closing][0].length !== match[0].length) closing++;
    if (closing === runs.length) {
      if (!declared) continue;
      throw new Error(`Invalid ${kind} annotation: expected a closed single-backtick annotation on one line.`);
    }
    const end = runs[closing].index!;
    cursor = closing;
    if (!declared) continue; // Other code spans, including multi-backtick examples.
    const body = text.slice(start + kind.length + 1, end);
    if (/[\r\n]/u.test(body)) throw new Error(`Invalid ${kind} annotation: annotations must stay on one line.`);
    const value = body.trim();
    if (!value || /\p{Cc}|\p{Cf}/u.test(value)) {
      throw new Error(`Invalid ${kind} annotation: expected non-empty text without control characters.`);
    }
    result.push(value);
  }
  return result;
}

function repositoryPath(value: string, directoryPattern: boolean): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  const prefix = directoryPattern && normalized.endsWith("/**") ? normalized.slice(0, -3) : normalized;
  if (Buffer.byteLength(normalized) > 4096 || /^[A-Za-z]:/u.test(normalized) || normalized.includes("://") ||
      prefix.includes("*") || prefix.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Invalid evidence path: expected a repository-relative file or supported directory/** pattern.");
  }
  return normalized;
}

export function extractPathReferences(text: string): string[] {
  return [...new Set(values(text, "change").map(value => repositoryPath(value, true)))];
}

export function extractCheckReferences(text: string): string[] {
  const names = values(text, "check");
  if (names.some(name => name.length > 128)) throw new Error("Invalid check annotation: name exceeds 128 characters.");
  return [...new Set(names)];
}

export function extractSymbolReferences(text: string): SymbolReference[] {
  const references = values(text, "symbol").map(value => {
    const separator = value.lastIndexOf("#");
    if (separator <= 0 || !/^[A-Za-z_$][\w$]*$/u.test(value.slice(separator + 1).trim())) {
      throw new Error("Invalid symbol annotation: expected repository-path#identifier.");
    }
    return { path: repositoryPath(value.slice(0, separator).trim(), false), symbol: value.slice(separator + 1).trim() };
  });
  return [...new Map(references.map(reference => [JSON.stringify([reference.path, reference.symbol]), reference])).values()];
}

export function validateEvidenceAnnotations(text: string): void {
  extractPathReferences(text);
  extractCheckReferences(text);
  extractSymbolReferences(text);
}
