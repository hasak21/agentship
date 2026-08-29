// Git Unified Diff Parser for AgentShip 2.0
import { DiffFile, DiffHunk, DiffLine, FileChangeType, ParsedDiff } from "@/types/diff";

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  cpp: "cpp",
  c: "c",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  sql: "sql",
};

export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return (ext && EXTENSION_LANGUAGE_MAP[ext]) || "text";
}

/**
 * Parses raw git diff string into structured file, hunk, and line objects.
 */
export function parseGitDiff(rawDiff: string): ParsedDiff {
  if (!rawDiff || !rawDiff.trim()) {
    return { files: [], totalAdditions: 0, totalDeletions: 0, fileCount: 0 };
  }

  const lines = rawDiff.split("\n");
  const files: DiffFile[] = [];
  let currentFile: Partial<DiffFile> | null = null;
  let currentHunk: DiffHunk | null = null;

  let oldLineNum = 0;
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // File header: diff --git a/... b/...
    if (line.startsWith("diff --git ")) {
      if (currentFile && currentFile.oldPath && currentFile.newPath) {
        if (currentHunk) {
          currentFile.hunks = currentFile.hunks || [];
          currentFile.hunks.push(currentHunk);
          currentHunk = null;
        }
        files.push(finalizeFile(currentFile));
      }

      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      currentFile = {
        oldPath: match ? match[1] : "unknown",
        newPath: match ? match[2] : "unknown",
        changeType: "modify",
        additions: 0,
        deletions: 0,
        hunks: [],
      };
      continue;
    }

    // New file mode
    if (line.startsWith("new file mode ") && currentFile) {
      currentFile.changeType = "add";
      continue;
    }

    // Deleted file mode
    if (line.startsWith("deleted file mode ") && currentFile) {
      currentFile.changeType = "delete";
      continue;
    }

    // Rename
    if (line.startsWith("rename from ") && currentFile) {
      currentFile.changeType = "rename";
      currentFile.oldPath = line.replace("rename from ", "").trim();
      continue;
    }
    if (line.startsWith("rename to ") && currentFile) {
      currentFile.newPath = line.replace("rename to ", "").trim();
      continue;
    }

    // Fallback file header --- a/... +++ b/...
    if (line.startsWith("--- ")) {
      if (!currentFile) {
        currentFile = {
          oldPath: line.replace(/^---\s+(a\/)?/, "").trim(),
          newPath: "unknown",
          changeType: "modify",
          additions: 0,
          deletions: 0,
          hunks: [],
        };
      } else {
        const path = line.replace(/^---\s+(a\/)?/, "").trim();
        if (path !== "/dev/null") currentFile.oldPath = path;
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      if (currentFile) {
        const path = line.replace(/^\+\+\+\s+(b\/)?/, "").trim();
        if (path !== "/dev/null") currentFile.newPath = path;
      }
      continue;
    }

    // Hunk header: @@ -1,5 +1,6 @@ optional description
    if (line.startsWith("@@ ")) {
      if (currentFile && currentHunk) {
        currentFile.hunks = currentFile.hunks || [];
        currentFile.hunks.push(currentHunk);
      }

      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (hunkMatch) {
        oldLineNum = parseInt(hunkMatch[1], 10);
        const oldLines = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
        newLineNum = parseInt(hunkMatch[3], 10);
        const newLines = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;

        currentHunk = {
          header: line,
          oldStart: oldLineNum,
          oldLines,
          newStart: newLineNum,
          newLines,
          lines: [],
        };
      }
      continue;
    }

    // Line inside a hunk
    if (currentHunk && currentFile) {
      if (line.startsWith("+")) {
        const diffLine: DiffLine = {
          type: "add",
          content: line.slice(1),
          newLineNumber: newLineNum++,
        };
        currentHunk.lines.push(diffLine);
        currentFile.additions = (currentFile.additions || 0) + 1;
      } else if (line.startsWith("-")) {
        const diffLine: DiffLine = {
          type: "del",
          content: line.slice(1),
          oldLineNumber: oldLineNum++,
        };
        currentHunk.lines.push(diffLine);
        currentFile.deletions = (currentFile.deletions || 0) + 1;
      } else if (line.startsWith(" ") || line === "") {
        const diffLine: DiffLine = {
          type: "context",
          content: line.startsWith(" ") ? line.slice(1) : line,
          oldLineNumber: oldLineNum++,
          newLineNumber: newLineNum++,
        };
        currentHunk.lines.push(diffLine);
      }
    }
  }

  // Push last file & hunk
  if (currentFile && (currentFile.oldPath || currentFile.newPath)) {
    if (currentHunk) {
      currentFile.hunks = currentFile.hunks || [];
      currentFile.hunks.push(currentHunk);
    }
    files.push(finalizeFile(currentFile));
  }

  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const f of files) {
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  }

  return {
    files,
    totalAdditions,
    totalDeletions,
    fileCount: files.length,
  };
}

function finalizeFile(partial: Partial<DiffFile>): DiffFile {
  const filePath = partial.newPath && partial.newPath !== "/dev/null"
    ? partial.newPath
    : partial.oldPath || "unknown";

  return {
    oldPath: partial.oldPath || filePath,
    newPath: partial.newPath || filePath,
    changeType: (partial.changeType as FileChangeType) || "modify",
    additions: partial.additions || 0,
    deletions: partial.deletions || 0,
    hunks: partial.hunks || [],
    language: getLanguageFromPath(filePath),
  };
}
