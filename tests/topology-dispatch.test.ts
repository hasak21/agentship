import test from "node:test";
import assert from "node:assert/strict";
import { dispatchTopology, type TopologyPattern } from "../src/lib/topology-dispatch";

test("consistency dispatch invokes only the consistency topology", async () => {
  const calls: TopologyPattern[] = [];
  const handler = (pattern: TopologyPattern) => async () => {
    calls.push(pattern);
    return pattern;
  };

  const result = await dispatchTopology("consistency", {
    single: handler("single"),
    debate: handler("debate"),
    router: handler("router"),
    consistency: handler("consistency"),
    auto: handler("auto"),
    orchestrator: handler("orchestrator"),
  });

  assert.equal(result, "consistency");
  assert.deepEqual(calls, ["consistency"]);
});

test("unknown topology names safely fall back to orchestrator", async () => {
  const calls: string[] = [];
  const unused = async () => "unused";
  const result = await dispatchTopology("invented-pattern", {
    single: unused,
    debate: unused,
    router: unused,
    consistency: unused,
    auto: unused,
    orchestrator: async () => {
      calls.push("orchestrator");
      return "orchestrator";
    },
  });

  assert.equal(result, "orchestrator");
  assert.deepEqual(calls, ["orchestrator"]);
});
