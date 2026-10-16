import type { CausalBaseReason, CheckEvidence } from "./types";

/** Revision discrimination only: no exit code proves a particular assertion failed. */
export function assessCausalBase(base: CheckEvidence): {
  satisfied: boolean;
  reason: CausalBaseReason;
} {
  let reason: CausalBaseReason;
  if (base.execution?.writableStorage?.accountingFailed) reason = "base_accounting_failure";
  else if (base.execution?.writableStorage?.exceeded) reason = "base_resource_limit";
  else if (base.execution?.cleanupFailed) reason = "base_cleanup_failed";
  else if (base.status === "timed_out") reason = "base_timed_out";
  else if (base.signal !== null) reason = "base_signal";
  else if (base.status !== "failed") reason = "base_not_failed";
  else if (base.exitCode === null) reason = "base_exit_unavailable";
  else if (base.exitCode === 0) reason = "base_zero_exit";
  // 126/127 denote execution/search failure; >=128 is ambiguous with shell
  // read/signal exits. Deliberate test exits in this range are conservative rejects.
  else if (!Number.isInteger(base.exitCode) || base.exitCode < 1 || base.exitCode >= 126) {
    reason = "base_ambiguous_shell_exit";
  } else reason = "normal_nonzero_exit";
  return { satisfied: reason === "normal_nonzero_exit", reason };
}
