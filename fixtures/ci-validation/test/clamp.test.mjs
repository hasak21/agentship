import test from "node:test";
import assert from "node:assert/strict";
import { clamp } from "../src/clamp.mjs";

test("clamp retains an interior value and handles both bounds", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});
