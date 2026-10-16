import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { mapRequirementsToChangedFiles } from "../src/review/requirement-mapper";
import {
  getGitProvenance,
  collectGitEvidence,
  resolveRepositoryRoot,
  resolveTrustedGitExecutable,
} from "../src/review/git";

const execFileAsync = promisify(execFile);

test("symbol and deletion evidence handles real Git quoted UTF-8 and quote-containing paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-quoted-diff-"));
  const git = (args: string[]) => execFileAsync("git", args, { cwd: directory });
  const files = ["src/会话.ts", 'src/a "quote".ts', "src/my file.ts"];
  const deleted = "tests/旧.test.ts";
  try {
    await git(["init", "-q"]);
    await git(["config", "user.name", "Test"]);
    await git(["config", "user.email", "test@example.com"]);
    await mkdir(path.join(directory, "src"));
    await mkdir(path.join(directory, "tests"));
    for (const file of files) await writeFile(path.join(directory, file), "export function handler() { return 0; }\n");
    await writeFile(path.join(directory, deleted), "test('old', () => {});\n");
    await git(["add", "."]);
    await git(["commit", "-qm", "base"]);
    for (const file of files) await writeFile(path.join(directory, file), "export function handler() { return 1; }\n");
    await rm(path.join(directory, deleted));
    const requirements = [...files.map(file => `Change \`symbol:${file}#handler\`.`), "Add regression tests."].map((text, index) => ({
      id: `R${index + 1}`, text, line: index + 1, confirmation: "not_required" as const, confirmationBasis: [],
    }));
    for (const quotePath of ["true", "false"]) {
      await git(["config", "core.quotePath", quotePath]);
      const evidence = await collectGitEvidence(directory, { staged: false });
      const mappings = mapRequirementsToChangedFiles(requirements, evidence.changedFiles, [], evidence.diff);
      assert.deepEqual(mappings.slice(0, files.length).map(row => row.status), ["observed", "observed", "observed"], evidence.diff);
      assert.equal(mappings.at(-1)?.status, "inferred_missing");
      assert.deepEqual(mappings.at(-1)?.roleEvidence[0].excludedDeletedFiles, [deleted]);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("untracked symlink evidence binds the link target, not external file contents", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-untracked-link-"));
  const repository = path.join(directory, "repository");
  const outside = path.join(directory, "outside");
  try {
    await mkdir(repository);
    await execFileAsync("git", ["init", "-q"], { cwd: repository });
    await execFileAsync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "base"], { cwd: repository });
    await writeFile(outside, "external content before");
    await symlink(outside, path.join(repository, "link"));
    const before = await collectGitEvidence(repository, { staged: false });
    await writeFile(outside, "external content after");
    const after = await collectGitEvidence(repository, { staged: false });
    assert.equal(before.diff, after.diff, "external file changes must not change repository evidence");
    assert.ok(before.diff.includes(createHash("sha256").update(outside).digest("hex")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Git changed paths retain newline, whitespace and quote bytes in every scope", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-git-nul-"));
  const git = (args: string[]) => execFileAsync("git", args, { cwd: directory });
  try {
    await git(["init", "-q"]);
    await git(["config", "user.name", "Test"]);
    await git(["config", "user.email", "test@example.com"]);
    await git(["commit", "--allow-empty", "-qm", "base"]);
    const { stdout: base } = await git(["rev-parse", "HEAD"]);
    const name = 'name\nwith\t"quotes" and trailing space ';
    await writeFile(path.join(directory, name), "content");
    const working = await collectGitEvidence(directory, { staged: false });
    assert.deepEqual(working.changedFiles, [name]);
    const manifest = working.diff.split("\n").find(line => line.startsWith("untracked:"))!;
    assert.equal(JSON.parse(manifest.slice("untracked:".length)).path, name);
    await git(["add", "."]);
    assert.deepEqual((await collectGitEvidence(directory, { staged: true })).changedFiles, [name]);
    await git(["commit", "-qm", "head"]);
    assert.deepEqual((await collectGitEvidence(directory, { staged: false, base: base.trim() })).changedFiles, [name]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Git evidence ignores repository-controlled executable replacements", async (context) => {
  if (process.platform !== "linux" || !existsSync("/usr/bin/git")) {
    context.skip("system /usr/bin/git is unavailable");
    return;
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-git-trust-"));
  const fakeBin = path.join(directory, "node_modules", ".bin");
  const fakeGit = path.join(fakeBin, "git");
  const previousPath = process.env.PATH;
  try {
    await mkdir(fakeBin, { recursive: true });
    await writeFile(fakeGit, "#!/bin/sh\nexit 99\n", "utf8");
    await chmod(fakeGit, 0o755);
    await execFileAsync("/usr/bin/git", ["init"], { cwd: directory });

    const resolved = resolveTrustedGitExecutable(directory, "linux", {
      ...process.env,
      PATH: fakeBin,
    });
    assert.equal(resolved, "/usr/bin/git");

    process.env.PATH = fakeBin;
    assert.equal(await resolveRepositoryRoot(directory), directory);
    const provenance = await getGitProvenance(directory);
    assert.equal(provenance.executable, "/usr/bin/git");
    assert.match(provenance.version, /^git version /);
    const gitBytes = await readFile(provenance.executable);
    assert.equal(provenance.bytes, gitBytes.length);
    assert.equal(
      provenance.sha256,
      createHash("sha256").update(gitBytes).digest("hex")
    );
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});

test("Git resolution fails closed when only a repository executable is available", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentship-git-path-"));
  const fakeBin = path.join(directory, "node_modules", ".bin");
  try {
    await mkdir(fakeBin, { recursive: true });
    await writeFile(path.join(fakeBin, "git.exe"), "not trusted\n", "utf8");
    const environment: NodeJS.ProcessEnv = { ...process.env, PATH: fakeBin };
    delete environment.ProgramFiles;
    delete environment["ProgramFiles(x86)"];
    delete environment.LOCALAPPDATA;
    assert.throws(
      () => resolveTrustedGitExecutable(directory, "win32", environment),
      /could not find Git outside repository-controlled executable paths/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
