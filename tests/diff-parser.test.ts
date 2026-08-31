import test from "node:test";
import assert from "node:assert/strict";
import { parseGitDiff, getLanguageFromPath } from "../src/lib/diff-parser";

test("getLanguageFromPath accurately identifies programming languages", () => {
  assert.equal(getLanguageFromPath("src/index.ts"), "typescript");
  assert.equal(getLanguageFromPath("src/components/App.tsx"), "typescript");
  assert.equal(getLanguageFromPath("scripts/run.py"), "python");
  assert.equal(getLanguageFromPath("src/main.rs"), "rust");
  assert.equal(getLanguageFromPath("cmd/server.go"), "go");
  assert.equal(getLanguageFromPath("unknown.xyz"), "text");
});

test("parseGitDiff handles empty or blank inputs", () => {
  const result = parseGitDiff("");
  assert.equal(result.fileCount, 0);
  assert.equal(result.totalAdditions, 0);
  assert.equal(result.totalDeletions, 0);
  assert.deepEqual(result.files, []);
});

test("parseGitDiff accurately parses multi-file Git unified diff", () => {
  const sampleDiff = `diff --git a/src/math.ts b/src/math.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/math.ts
@@ -0,0 +1,5 @@
+export function add(a: number, b: number): number {
+  return a + b;
+}
diff --git a/tests/math.test.ts b/tests/math.test.ts
--- a/tests/math.test.ts
+++ b/tests/math.test.ts
@@ -1,3 +1,6 @@
-import { oldAdd } from "./math";
+import { add } from "../src/math";
+import { test, expect } from "vitest";
 
+test("adds numbers", () => {
+  expect(add(1, 2)).toBe(3);
+});`;

  const parsed = parseGitDiff(sampleDiff);
  assert.equal(parsed.fileCount, 2);
  assert.equal(parsed.totalAdditions, 8);
  assert.equal(parsed.totalDeletions, 1);

  const file1 = parsed.files[0];
  assert.equal(file1.newPath, "src/math.ts");
  assert.equal(file1.changeType, "add");
  assert.equal(file1.additions, 3);
  assert.equal(file1.deletions, 0);
  assert.equal(file1.language, "typescript");

  const file2 = parsed.files[1];
  assert.equal(file2.newPath, "tests/math.test.ts");
  assert.equal(file2.additions, 5);
  assert.equal(file2.deletions, 1);
});
