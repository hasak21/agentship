import test from "node:test";
import assert from "node:assert/strict";
import { collectFileDiffEvidence, decodeGitPathField } from "../src/review/git-diff-evidence";

test("Git path decoding preserves UTF-8 octal bytes, quotes, separators and spaces", () => {
  assert.equal(decodeGitPathField('"b/\\344\\274\\232\\350\\257\\235.ts"'), "b/会话.ts");
  assert.equal(decodeGitPathField('"b/a \\"quote\\".ts"\t'), 'b/a "quote".ts');
  assert.equal(decodeGitPathField("b/trailing space \t"), "b/trailing space ");
  assert.equal(decodeGitPathField('"b/a\\tb.ts"'), "b/a\tb.ts");
  assert.equal(decodeGitPathField('"\\357\\273\\277name"'), "\ufeffname");
});

test("Git path decoding rejects malformed escapes, raw controls and invalid UTF-8", () => {
  for (const field of ['"b/raw\nname"', '"b/raw\rname"', '"b/\\000name"', '"b/\\400name"',
    '"b/\\377name"', '"b/\\qname"', '"b/unterminated', '"b/path"trailing', "b/raw\tname", "", '""', "\t"]) {
    assert.equal(decodeGitPathField(field), undefined, JSON.stringify(field));
  }
});

test("repeated records append evidence without repeatedly copying accumulated lines", () => {
  const record = "diff --git a/src/file.ts b/src/file.ts\n@@ -0,0 +1 @@\n+handler();\n";
  const observed = collectFileDiffEvidence(record.repeat(10_000), ["src/file.ts"]);
  assert.equal(observed.get("src/file.ts")?.lines.length, 10_000);
  assert.equal(observed.get("src/file.ts")?.deleted, false);
});

test("hunk text cannot redirect evidence to another known path", () => {
  const diff = `diff --git a/src/real.ts b/src/real.ts
--- a/src/real.ts
+++ b/src/real.ts
@@ -0,0 +1,3 @@
+++ b/src/forged.ts
+rename to src/forged.ts
+export function handler() {}`;
  const observed = collectFileDiffEvidence(diff, ["src/real.ts", "src/forged.ts"]);
  assert.equal(observed.has("src/forged.ts"), false);
  assert.ok(observed.get("src/real.ts")?.lines.some(line => line.includes("handler")));
});

test("binary deletion and rename metadata decode quoted paths without inventing symbol lines", () => {
  const deleted = 'tests/旧 "name".test.ts';
  const renamed = 'src/new "name".ts';
  const diff = `diff --git "a/tests/旧 \\"name\\".test.ts" "b/tests/旧 \\"name\\".test.ts"
deleted file mode 100644
Binary files a/ignored and /dev/null differ
diff --git a/src/old.ts "b/src/new \\"name\\".ts"
similarity index 100%
rename from src/old.ts
rename to "src/new \\"name\\".ts"`;
  const observed = collectFileDiffEvidence(diff, [deleted, renamed]);
  assert.deepEqual(observed.get(deleted), { lines: [], deleted: true });
  assert.deepEqual(observed.get(renamed), { lines: [], deleted: false });
});

test("type-change records merge changed lines but preserve the final non-deleted state", () => {
  const diff = `diff --git a/tests/type.test.ts b/tests/type.test.ts
deleted file mode 120000
--- a/tests/type.test.ts
+++ /dev/null
@@ -1 +0,0 @@
-old-target
diff --git a/tests/type.test.ts b/tests/type.test.ts
new file mode 100644
--- /dev/null
+++ b/tests/type.test.ts
@@ -0,0 +1 @@
+test('handler', () => {});`;
  const observed = collectFileDiffEvidence(diff, ["tests/type.test.ts"]);
  assert.deepEqual(observed.get("tests/type.test.ts"), {
    lines: ["old-target", "test('handler', () => {});"], deleted: false,
  });
  assert.equal(collectFileDiffEvidence(diff, []).size, 0);
});
