export type TopologyPattern =
  | "single"
  | "debate"
  | "router"
  | "consistency"
  | "auto"
  | "orchestrator";

export type TopologyHandlers<T> = Record<TopologyPattern, () => Promise<T> | T>;

export function normalizeTopologyPattern(pattern: string): TopologyPattern {
  switch (pattern) {
    case "single":
    case "debate":
    case "router":
    case "consistency":
    case "auto":
    case "orchestrator":
      return pattern;
    default:
      return "orchestrator";
  }
}

export function dispatchTopology<T>(
  pattern: string,
  handlers: TopologyHandlers<T>
): Promise<T> | T {
  return handlers[normalizeTopologyPattern(pattern)]();
}
