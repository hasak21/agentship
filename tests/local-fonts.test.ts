import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);

async function sha256(relativePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(new URL(relativePath, root)))
    .digest("hex");
}

test("layout uses pinned local Geist assets without a Google font loader", async () => {
  const layout = await readFile(new URL("src/app/layout.tsx", root), "utf8");
  assert.match(layout, /from "next\/font\/local"/);
  assert.match(layout, /\.\/fonts\/Geist-Variable\.woff2/);
  assert.match(layout, /\.\/fonts\/GeistMono-Variable\.woff2/);
  assert.doesNotMatch(layout, /next\/font\/google|fonts\.googleapis\.com/);

  assert.equal(
    await sha256("src/app/fonts/Geist-Variable.woff2"),
    "2ffebe993e969069a9789d15164b7715d42491b5835516c5e3b935d5f81b05f1"
  );
  assert.equal(
    await sha256("src/app/fonts/GeistMono-Variable.woff2"),
    "afaacc4c5fbba89d2ebf7a02dc4070208540874592a5504d57175782fe893101"
  );
  assert.equal(
    await sha256("src/app/fonts/LICENSE.txt"),
    "930853ee1daa68554d9e35c8a9175affb74f699fad9a5da6ee5ebe76379d9137"
  );
});

test("every checked-in review policy denies check network access", async () => {
  for (const policyPath of [
    ".agentship.yml",
    ".agentship.bubblewrap.yml",
    ".agentship.ci.yml",
  ]) {
    const policy = parse(
      await readFile(new URL(policyPath, root), "utf8")
    ) as { checks?: Array<{ name?: string; network?: string }> };
    assert.ok(policy.checks?.length, `${policyPath} must configure checks`);
    for (const check of policy.checks ?? []) {
      assert.equal(
        check.network,
        "denied",
        `${policyPath} check ${check.name ?? "<unnamed>"} must deny network`
      );
    }
  }
});
