export interface FileDiffObservation { lines: string[]; deleted: boolean }

/** Decode Git C-quoted path bytes, rejecting malformed escapes and invalid UTF-8. */
function quotedPath(input: string): { path: string; consumed: number } | undefined {
  const source = Buffer.from(input, "utf8");
  const bytes: number[] = [];
  const escapes: Record<number, number> = { 97: 7, 98: 8, 116: 9, 110: 10, 118: 11, 102: 12, 114: 13, 34: 34, 92: 92 };
  for (let index = 1; index < source.length; index++) {
    const byte = source[index];
    if (byte === 34) {
      try {
        return { path: new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)), consumed: index + 1 };
      } catch { return undefined; }
    }
    if (byte !== 92) { if (!byte) return undefined; bytes.push(byte); continue; }
    const escaped = source[++index];
    if (escapes[escaped] !== undefined) { bytes.push(escapes[escaped]); continue; }
    const octal = source.subarray(index, index + 3).toString("ascii");
    if (!/^[0-7]{3}$/.test(octal)) return undefined;
    const value = parseInt(octal, 8);
    if (!value || value > 255) return undefined;
    bytes.push(value);
    index += 2;
  }
  return undefined;
}

export function decodeGitPathField(input: string): string | undefined {
  if (!input || input.length > 64 * 1024) return undefined;
  if (input.startsWith('"')) {
    const decoded = quotedPath(input);
    if (!decoded) return undefined;
    // Git appends a tab separator to some ---/+++ fields containing spaces.
    const suffix = Buffer.from(input, "utf8").subarray(decoded.consumed).toString("utf8");
    return suffix === "" || suffix === "\t" ? decoded.path : undefined;
  }
  const value = input.endsWith("\t") ? input.slice(0, -1) : input;
  return /["\u0000-\u001f\u007f]/u.test(value) ? undefined : value;
}

function headerPath(body: string, known: Set<string>): string | undefined {
  if (body.length > 64 * 1024) return undefined;
  let field: string | undefined;
  if (body.startsWith('"')) {
    const first = quotedPath(body);
    if (!first?.path.startsWith("a/")) return undefined;
    const remainder = Buffer.from(body, "utf8").subarray(first.consumed).toString("utf8");
    if (!remainder.startsWith(" ")) return undefined;
    field = decodeGitPathField(remainder.slice(1));
  } else if (body.includes(' "b/')) {
    field = decodeGitPathField(body.slice(body.indexOf(' "b/') + 1));
  } else {
    // Space-containing unquoted names are ambiguous without the captured name set.
    const candidates = new Set<string>();
    let attempts = 0;
    for (const match of body.matchAll(/ b\//g)) {
      if (++attempts > 128) return undefined;
      const value = decodeGitPathField(body.slice(match.index! + 1));
      if (value?.startsWith("b/") && known.has(value.slice(2))) candidates.add(value.slice(2));
    }
    return candidates.size === 1 ? [...candidates][0] : undefined;
  }
  return field?.startsWith("b/") && known.has(field.slice(2)) ? field.slice(2) : undefined;
}

export function collectFileDiffEvidence(diff: string, changedFiles: string[]): Map<string, FileDiffObservation> {
  const known = new Set(changedFiles);
  const observations = new Map<string, FileDiffObservation>();
  let current: { path?: string; oldPath?: string; observation: FileDiffObservation; inHunk: boolean } | undefined;
  const flush = () => {
    if (!current?.path || !known.has(current.path)) return;
    const previous = observations.get(current.path);
    observations.set(current.path, {
      lines: [...(previous?.lines ?? []), ...current.observation.lines],
      deleted: current.observation.deleted,
    });
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff ")) {
      flush();
      current = line.startsWith("diff --git ") ? {
        path: headerPath(line.slice("diff --git ".length), known),
        observation: { lines: [], deleted: false }, inHunk: false,
      } : undefined;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("@@ ")) { current.inHunk = true; continue; }
    if (current.inHunk) {
      if (line.startsWith("+") || line.startsWith("-")) current.observation.lines.push(line.slice(1));
      continue;
    }
    if (/^deleted file mode \d+$/.test(line)) current.observation.deleted = true;
    else if (line.startsWith("--- ")) {
      const decoded = decodeGitPathField(line.slice(4));
      current.oldPath = decoded?.startsWith("a/") ? decoded.slice(2) : undefined;
    } else if (line.startsWith("+++ ")) {
      const decoded = decodeGitPathField(line.slice(4));
      if (decoded === "/dev/null") {
        current.observation.deleted = true;
        current.path = current.oldPath ?? current.path;
      } else current.path = decoded?.startsWith("b/") ? decoded.slice(2) : undefined;
    } else if (line.startsWith("rename to ")) current.path = decodeGitPathField(line.slice(10));
  }
  flush();
  return observations;
}
