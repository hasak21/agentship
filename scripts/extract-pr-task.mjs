import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAX_BODY_BYTES = 128 * 1024;

export function buildPullRequestTask(event) {
  const pullRequest = event?.pull_request;
  if (!pullRequest || typeof pullRequest !== "object") {
    throw new Error("GitHub event does not contain a pull_request object.");
  }
  const title = typeof pullRequest.title === "string" ? pullRequest.title : "Untitled pull request";
  const body = typeof pullRequest.body === "string" ? pullRequest.body : "";
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
    throw new Error(`Pull request body exceeds ${MAX_BODY_BYTES} bytes.`);
  }
  return `# ${title.replace(/[\r\n]+/g, " ").trim()}\n\n${body.trim()}\n`;
}

async function main() {
  const [eventPath, outputPath] = process.argv.slice(2);
  if (!eventPath || !outputPath) {
    throw new Error("Usage: extract-pr-task.mjs <event.json> <task.md>");
  }
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  await writeFile(outputPath, buildPullRequestTask(event), "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
