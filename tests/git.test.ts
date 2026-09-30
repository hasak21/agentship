import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  getGitProvenance,
  resolveRepositoryRoot,
  resolveTrustedGitExecutable,
} from "../src/review/git";

const execFileAsync = promisify(execFile);

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
