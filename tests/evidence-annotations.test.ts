import test from "node:test";
import assert from "node:assert/strict";
import { extractPathReferences, extractCheckReferences, extractSymbolReferences, validateEvidenceAnnotations } from "../src/review/evidence-annotations";
import { parseTaskRequirements } from "../src/review/task-parser";

test("explicit paths support root files, spaces, dotfiles and literal route brackets", () => {
  assert.deepEqual(extractPathReferences("`change:Dockerfile` `change:Makefile` `change:.env.example` `change:src/my file.ts` `change:src/app/[id]/page.tsx`"),
    ["Dockerfile", "Makefile", ".env.example", "src/my file.ts", "src/app/[id]/page.tsx"]);
  assert.deepEqual(extractPathReferences("`change:./src/file.ts`"), ["src/file.ts"]);
  assert.deepEqual(extractPathReferences("`change:src\\file.ts` `change:src/file.ts` `change:src/**`"), ["src/file.ts", "src/**"]);
});

test("malformed known annotations are errors rather than absent mandates", () => {
  for (const text of [
    "`change:`", "`change:../outside.ts`", "`change:/absolute.ts`", "`change:C:\\absolute.ts`",
    "`change:https://example.com/file.ts`", "`change:src//file.ts`", "`change:src/*.ts`",
    "`check:`", "`check:bad\u202ename`", "`symbol:no-path`", "`symbol:src/file.ts#bad-name`",
    "`symbol:src/**#handler`", "`change:src/file.ts", "`check:test\nextra`", "`change:src/file.ts``",
  ]) {
    assert.throws(() => validateEvidenceAnnotations(text), /Invalid/, text);
    assert.throws(() => parseTaskRequirements(`## Requirements\n1. ${text}\n`), /Task requirement 'R1'/, text);
  }
});

test("annotation recognition respects complete code spans and escaped examples", () => {
  const text = "``change:../outside`` ``symbol:no-path`` `ordinary change:foo` \\`check:`";
  assert.doesNotThrow(() => validateEvidenceAnnotations(text));
  assert.deepEqual(extractPathReferences(text), []);
  assert.deepEqual(extractCheckReferences(text), []);
  // The second run closes the ordinary span; it must not also open an annotation.
  assert.deepEqual(extractPathReferences("`ordinary `change:Dockerfile`"), []);
  assert.deepEqual(extractPathReferences("``example `change:Dockerfile` `` `change:Makefile`"), ["Makefile"]);
});

test("check and symbol references retain exact bounded identities", () => {
  assert.deepEqual(extractCheckReferences("`check:npm test` `check:npm test`"), ["npm test"]);
  assert.deepEqual(extractSymbolReferences("`symbol:src/my file.ts#handler` `symbol:Dockerfile#entry`"), [
    { path: "src/my file.ts", symbol: "handler" }, { path: "Dockerfile", symbol: "entry" },
  ]);
  assert.throws(() => extractCheckReferences(`\`check:${"x".repeat(129)}\``), /128 characters/);
  assert.throws(() => extractPathReferences(`\`change:${"é".repeat(2049)}\``), /Invalid evidence path/);
});
