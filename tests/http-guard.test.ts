import test from "node:test";
import assert from "node:assert/strict";
import {
  HttpGuardError,
  readBoundedJsonObject,
  requireApiAccess,
} from "../src/lib/http-guard";

test("bounded JSON accepts an object within the byte limit", async () => {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "ok" }),
  });
  assert.deepEqual(await readBoundedJsonObject(request, 100), { value: "ok" });
});

test("bounded JSON rejects oversized and non-object payloads", async () => {
  const oversized = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "too large" }),
  });
  await assert.rejects(
    () => readBoundedJsonObject(oversized, 5),
    (error: unknown) => error instanceof HttpGuardError && error.status === 413
  );

  const array = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "[]",
  });
  await assert.rejects(
    () => readBoundedJsonObject(array, 100),
    (error: unknown) => error instanceof HttpGuardError && error.status === 400
  );
});

test("API access is open locally by default and bearer-protected when configured", () => {
  const previous = process.env.AGENTSHIP_API_TOKEN;
  delete process.env.AGENTSHIP_API_TOKEN;
  try {
    assert.doesNotThrow(() => requireApiAccess(new Request("http://localhost/api/test")));

    process.env.AGENTSHIP_API_TOKEN = "expected-token";
    assert.throws(
      () => requireApiAccess(new Request("http://localhost/api/test")),
      (error: unknown) => error instanceof HttpGuardError && error.status === 401
    );
    assert.doesNotThrow(() =>
      requireApiAccess(
        new Request("http://localhost/api/test", {
          headers: { Authorization: "Bearer expected-token" },
        })
      )
    );
  } finally {
    if (previous === undefined) delete process.env.AGENTSHIP_API_TOKEN;
    else process.env.AGENTSHIP_API_TOKEN = previous;
  }
});
