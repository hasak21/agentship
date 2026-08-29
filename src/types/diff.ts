// Diff data types for Visual Diff Review in AgentShip 2.0

export type LineType = "add" | "del" | "context" | "header";

export type DiffLine = {
  type: LineType;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

export type FileChangeType = "modify" | "add" | "delete" | "rename";

export type DiffFile = {
  oldPath: string;
  newPath: string;
  changeType: FileChangeType;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  language?: string;
  binary?: boolean;
};

export type ParsedDiff = {
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  fileCount: number;
};
