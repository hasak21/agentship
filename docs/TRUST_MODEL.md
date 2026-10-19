# AgentShip Trust Model

AgentShip verifies agent-written changes; it does not trust an agent's account of what it changed or executed.

Untracked working-tree evidence uses NUL-delimited Git path lists and JSON-escaped
single-line manifest records (`untracked:{path,kind,mode,bytes,sha256}`), not raw path
interpolation. Regular files are hashed sequentially with a 1 MiB buffer, limited to
32 MiB per file, 128 MiB aggregate and 10,000 unique untracked entries. The capture
rejects special files (including FIFOs), multiply linked regular files and ambiguous
paths, and aborts when observed identity/size/mode/timestamps change. A symbolic link
is evidence about its target text only: neither existing nor dangling targets are
opened. Changing a link's external target contents therefore does not mutate repository
evidence. Permission changes to untracked regular files are now hash-bound metadata.

On Linux, source ancestors use the same pinned, no-follow directory traversal as
causal overlays. The non-Linux local fallback checks ancestors and uses available
no-follow open flags, but is not equivalent protection against concurrent host
mutation. These changes intentionally alter working-tree diff hashes for untracked
files compared with the former content-only/raw-line record format; old artifacts
remain historical snapshots, not byte-identical replays under the new capture format.
Git's own tracked diff capture and sandbox workspace copying are separate input paths;
the latter's additional confinement is described below. Neither establishes that every
pre-sandbox filesystem operation or concurrent host mutation is confined.

Host-side Git evidence commands and sandbox file enumeration explicitly set
`core.fsmonitor=false`, so a configured filesystem-monitor executable is not invoked
while reading the index. Temporary causal worktrees use a private empty hooks directory
for creation/removal, overriding both default hooks and configured `core.hooksPath`,
and set `submodule.recurse=false`. These are command-local options, not persisted
configuration changes. Regression controls prove the installed Git can invoke the
configured hooks, while AgentShip capture/copy and worktree creation do not run them.
Before tracked diff/stat inspection, AgentShip checks effective working-tree and
cached `filter` attributes for tracked paths, using bounded literal-path argument
batches. Active filter attributes are refused before Git can invoke clean conversion.
Unused configured drivers remain allowed. Configured drivers literally named `unset`
or `unspecified` are conservatively refused because Git's attribute output cannot
distinguish those strings from its Boolean/missing-value markers.

Temporary worktrees are now registered with `--no-checkout`, populated via a private
index only, and inspected with cached attributes from the requested commit before
file checkout. This matters when historical base attributes differ from the source
checkout. Active filter attributes abort preparation and remove the temporary
registration; no smudge/process driver runs and no silent unfiltered fallback is used.
Ordinary filter-free trees (including explicit `-filter`) still materialize normally.
These command-local guards do not rewrite filter configuration. Repositories needing
filter transformations require future isolated materialization and currently fail
closed. This is not a complete checkout sandbox or native Git I/O/resource quota;
other host-side transformations and concurrent same-user host mutation remain outside
the completed boundary.

Omission-adjudication packets bind reviewer assertions to exact corpus bytes, task text,
patches, file lists and base revisions. `reviewer_asserted_omission` is not authenticated
human identity or executed evidence: reviewer names and evidence locators are supplied
claims, and locators are not fetched or independently verified. Unreviewed/abstained
cases are excluded from metrics with coverage retained; partial selection can bias
results. Outcome-blinded packets omit explicit model/outcome/detector fields, but patch
and issue text may still reveal identity or clues. Independent adjudication remains
an operational requirement, not a guarantee of this format.

## Evidence hierarchy

1. **Claimed** — supplied by an agent, contributor, or model. Never sufficient to pass a check.
2. **Inferred** — produced by static analysis or an LLM. Useful for investigation, but non-blocking by default.
3. **Observed** — captured directly by AgentShip from Git, a command, or a tool response.
4. **Reproduced** — an observed failure with an executable reproduction, ideally failing before a repair and passing afterward.
5. **Attested** — an explicit human decision bound to a specific report and change hash.

Only observed, reproduced, or explicitly attested evidence may satisfy a required check. LLM output must never be represented as proof that a command ran.

## Bootstrap boundary

The first local runner executes commands from the repository's trusted `.agentship.yml`. It is intended for a developer's own checkout. It is not yet safe for hostile pull requests because repository commands execute on the host.

Configuration parsing is fail-closed and availability-bounded before any configured
command runs. AgentShip reads at most 256 KiB from a regular file into a fixed buffer,
bounds check and policy-list cardinalities, validates scalar types and environment-variable
identifiers, rejects control characters in human-facing check/path identities, and rejects
duplicate check, protected-path, suppression, and blocking-kind identities. Commands are
bounded to 16 KiB each. These controls prevent ambiguous evidence and parser amplification;
they do not make a locally selected policy trustworthy. Hostile CI must still load policy
from the separately checked-out trusted base revision.

Before privileged maintainer-side execution, AgentShip must add aggregate kernel-enforced worker budgets and authenticated policy/approval provenance. The current hosted report workflow provisions a digest-pinned bubblewrap package and combines disposable-copy, filesystem, PID, default network isolation, a cumulative check wall-clock deadline, and per-process limits. It remains secretless, neutral, and non-gating; the publisher attests the validated canonical report, but the subject execution itself is not workload-attested.

## Evidence manifest

Each report binds together:

- Git head, review scope, changed paths, and a SHA-256 digest of the reviewed diff;
- task and configuration digests;
- exact commands, timing, exit status, and bounded output;
- the canonical Git executable path, bounded version, exact byte length, and SHA-256 used
  to calculate repository evidence;
- the canonical AgentShip entrypoint path, exact byte length, and SHA-256;
- platform, architecture, kernel release, optional bounded OS-release identity/hash, and the
  canonical launching Node executable path, exact byte length, and SHA-256;
- optional bounded GitHub runner and image environment metadata;
- findings derived from that captured evidence;
- the AgentShip schema and tool version.

The JSON report can now be accompanied by a detached Ed25519 signature. The signed
canonical statement binds the exact report byte length and SHA-256 to the trusted public
key's SPKI SHA-256. Verification recomputes all three values and requires an explicitly
supplied public key outside the verifier's trusted working root; the sidecar does not
carry a self-authorizing key. Signing private keys must resolve outside the reviewed
repository and, on POSIX, deny group/other access. See `docs/EVIDENCE_SIGNATURES.md`.

Signatures authenticate possession of a configured key, not a person's identity, unless
the operator separately maps that public-key fingerprint to an owner. The ordinary local
flow remains unsigned unless signing is explicitly configured. Current CI intentionally
sends no signing secret into the pull-request job. The separate official publisher now
attests exact canonical post-validation bytes using GitHub workload identity and a
short-lived Sigstore certificate. That authenticates the publisher workflow and digest,
not the subject runner or claims within the report. Key rotation, HSM/KMS support,
authenticated Ed25519 key ownership, trusted timestamps for local signatures, and
subject-runner/build attestations remain open provenance work.

## Verifier tool resolution

Every CLI review canonicalizes its actual `process.argv[1]` entrypoint, bounds it to 32
MiB, reads it through one open file handle, rejects concurrent size/mtime/inode changes,
and records its byte length and SHA-256. In standalone and official CI operation this is
the exact self-contained `agentship.cjs` bundle. The privileged publisher requires
well-formed bounded verifier provenance before accepting an artifact and shows the digest
in its neutral Check Run summary. A detached report signature, when separately enabled,
also covers these fields because it signs the exact JSON bytes.

In `npm run review` source mode, the entrypoint is `src/cli/index.ts`; its digest does not
cover imported source files, installed dependencies, or loader behavior. Every CLI review
separately hashes the exact launching Node executable, records bounded host/OS identity,
and includes GitHub runner/image environment metadata when available. The privileged
publisher requires the official report to claim GitHub-hosted Linux X64 execution and
validates all those fields structurally. These fields identify bytes and claims rather than
authenticating them. Trust still comes from how the operator obtained the runtime/bundle
and, for signed evidence, how the public key was established. Signed runner-image,
kernel/workload, dependency, and build-reproducibility attestations remain open.

Repository evidence never resolves `git` through an unfiltered inherited `PATH`.
AgentShip prefers canonical host-owned system locations on Linux, macOS, and Windows;
fallback search accepts only absolute directories outside the reviewed checkout and
rejects every `node_modules/.bin` segment. Symlink targets are canonicalized and checked
again. If no such executable exists, review fails closed. The selected canonical path and
the bounded `git --version` result are retained in evidence. AgentShip hashes the bounded
binary through a stable file handle before and after version execution, records its byte
length and SHA-256, and repeats provenance collection after checks; a mismatch fails the
review without producing misleading evidence.

This protects the common `npm run review` case where npm injects repository package bins
ahead of system paths. It does not authenticate the host operating system or protect
against a privileged administrator substituting and restoring a system Git binary between
observations. OS-package signatures, reproducible Git builds, shared-library identity, and
signed runner/workload provenance remain unfinished evidence-attestation work.

## Public provider boundary

Next.js route handlers are public endpoints. They may select a supported provider and model, but they cannot supply credentials or provider base URLs. Network destinations and server credentials remain deployment-owned configuration.

The lower-level provider client also refuses to inherit an environment credential when code supplies an explicit base URL without an explicit credential. This is defense in depth against future route regressions.

Provider availability is bounded at the response boundary as well as the request boundary.
Every protocol applies a 4,096-token output default (internal callers may request only a
validated 1–65,536 range), streams at most 4 MiB of response bytes, rejects invalid UTF-8
or JSON, and keeps the abort deadline active until the complete bounded body is consumed.
Declared oversized bodies are rejected before consumption and streamed excess cancels the
reader. These are per-call bounds; deployment-level authentication, rate limits, concurrent
request caps, and aggregate spending controls remain operator responsibilities.

The research route also creates one shared budget before any topology executes. Planner,
worker, debate, critic, comparison, and judge calls atomically reserve against default
limits of 20 calls, 4 MiB of cumulative prompt content, 65,536 output tokens, 100,000
provider-reported total tokens, and 180 seconds. Parallel branches share the same object,
so a fan-out cannot independently receive the full allowance. Every call timeout is
clamped to the remaining run lifetime; exhausted budgets prevent subsequent provider
calls and are emitted as start/final SSE evidence. Deployment environment overrides are
bounded and invalid values fail closed. Reported usage remains a provider claim, and these
limits are resource proxies—not a currency-denominated or service-wide spending cap.

Reservations occur in the provider transport immediately before each fetch, including
internal HTTP retries. A failed attempt retains its call, prompt-byte, and output-token
reservation. Retry backoff is bounded by the remaining run lifetime, and budget exceptions
keep their type through all provider adapters so the node supervisor does not retry them.
Regression tests reproduce the former bypass (two HTTP requests under a one-call budget)
and now require exactly one fetch and matching final SSE accounting.

## Local check environment

Local checks receive a minimal cross-platform environment allowlist. A repository may request additional variable names for a check, but captured evidence records only those names. Values whose names indicate credentials, tokens, cookies, passwords, secrets, or authenticated proxies are redacted from stdout and stderr.

Timeouts target the spawned POSIX process group (or Windows `taskkill /t`), not only
the shell parent. A repository-owned `limits.maxCheckSeconds` deadline covers
cumulative check preparation/execution, initiates termination when the remaining
time expires, and prevents later applicable checks from starting after exhaustion.
Forced kill has a one-second grace; outstanding stdout/stderr pipes are then closed
and output marked truncated so escaped descendants holding inherited descriptors
cannot indefinitely delay report finalization. Timeout/failure status is preserved
even if the original shell exited zero. This closes a verifier-hang path, not an
escape-containment boundary: detached direct-mode descendants can survive the
original process group and require external cleanup. Sandbox cleanup and
uninterruptible kernel operations can extend observed time beyond the deadline.
Checks with a `resources` policy execute on Linux through `/usr/bin/prlimit` with
exact CPU-time, virtual-address-space, file-size, and open-file limits; configuration
fails closed when that backend is unavailable. Children inherit kernel limits, but
CPU, memory, process-count, and disk consumption are not aggregated across the
process tree. This is a reliability boundary, not hostile-code isolation: direct
checks still retain the host filesystem and network view.

For direct checks, the `network` field remains a declared capability recorded in evidence
rather than an enforced boundary. For checks with `isolation: bubblewrap`, it is enforced: absent or
`denied` creates a fresh network namespace, while `allowed` deliberately shares the host
network namespace and mounts only resolver/certificate configuration needed by clients.
Non-isolated checks retain the older declaration-only behavior. The report distinguishes
the backend, disposable workspace, filesystem profile, and effective network mode so a
consumer cannot confuse a direct check with an isolated one.

The bubblewrap worker makes a bounded copy of Git-tracked and non-ignored untracked
repository content, omitting `.git`, `.agentship`, ignored local secrets, and
`node_modules`; a host-installed dependency tree is mounted read-only.
Workspace preparation now pins both roots and each traversed directory through Linux
directory descriptors and no-follow opens. It refuses an existing destination root,
creates regular destination files exclusively, and never traverses copied links as
parents. Leaf links retain their raw target bytes rather than target contents, including
dangling or absolute links (their runtime meaning is constrained by the worker mount
namespace). Non-regular/multiply linked file sources and observed identity/size/mode/
timestamp changes fail preparation. Modes retain ordinary executable permissions but
not setuid/setgid bits. Copies use a fixed 1 MiB buffer and charge actual copied bytes
plus link-target bytes against 2 GiB; the 200,000-entry limit includes conservatively
projected parent directories as well as listed leaves. Missing tracked paths are
omitted as deletions. Temporary preparation trees are discarded by the caller on
failure, and no check is executed from a partial copy. Reflink optimization is no
longer used in this path. Git/runtime integrity, trusted source/destination root
ownership, dependency mounts and concurrent same-UID host mutation remain separate
trust assumptions; this is not a hard disk quota or VM/kernel boundary.
The worker receives only `/usr`, essential library paths, the active Node distribution,
a private `/proc`, minimal `/dev`, and fresh temporary/home directories. It does not see
the host home, `/etc`, or repository writes made inside the disposable copy. An explicitly
network-allowed worker additionally receives read-only TLS and resolver files. Copy setup
is bounded to 200,000 entries and 2 GiB and fails closed on special files or unavailable
Linux user namespaces. An optional fail-closed writable-storage monitor samples aggregate
logical bytes across the disposable workspace and private `/tmp`, including a final sample
after process exit. It records the maximum observation and terminates the process tree on
excess or accounting failure. An entry that disappears during traversal is normal worker
churn and is omitted from that observation; other traversal errors fail closed. Sampling is not a hard filesystem quota and can miss
short-lived spikes. This boundary does not prevent kernel exploits, side channels,
resource use outside current per-process limits, or malicious behavior in an explicitly
mounted runtime/dependency tree.

Isolated checks also drop environment names shaped like credentials, tokens, cookies,
passwords, or secrets even when requested by policy. Proxy variables are retained only
for credential-free origin URLs, while `NO_PROXY` remains routing data. This is defense
in depth, not semantic secret detection: an operator can still place a secret under an
innocuous custom name, so hostile-check policies must never request unknown sensitive
values.

## Public API boundary

AgentShip binds its web server to localhost by default. Audit, research, and MCP requests have explicit body limits and object validation. Deployments that expose these endpoints should set `AGENTSHIP_API_TOKEN`; expensive POST requests then require the corresponding bearer token.

This application-level token is a first boundary, not a complete multi-tenant authorization or distributed rate-limiting system. Internet-facing deployments still require TLS, host-level rate limiting, and secret management.

Outbound provider calls use aborting deadlines. The default provider deadline is shorter than the multi-agent supervisor deadline, preventing a timed-out node from leaving an indefinitely running fetch behind. This bounds individual requests but does not replace total-run cost budgets.

## Task intent input

Review/history artifact publication is also a host-side boundary. Review `--output`
must resolve to a repository child outside `.git` administration paths; absolute
external output paths previously accepted by the local runner are now rejected.
Linux publication pins parent directories with no-follow traversal, preflights all
destinations, rejects linked/non-regular leaves, and stages private (0600) files
exclusively before atomic rename. Existing regular reports may be replaced, but their
hardlink aliases are not modified. History directory creation uses the same confined
traversal before writing, rather than creating through a link and checking afterward.
No report file is published when preflight rejects another member of its batch;
safe parent directories may already have been created. Publication is atomic per file,
not a multi-file transaction or crash-durability guarantee. The non-Linux local fallback
checks directory ancestry but does not provide Linux descriptor pinning. Concurrent
same-UID host mutation and compromised runtime/root ownership remain outside these
guarantees; other command-specific output writers have separate validation boundaries.

Version 1 extracts only numbered items written under a Markdown `Requirements` heading. Each receives a stable identifier and source line in the evidence manifest. These items are explicit task input, not proof that the implementation satisfies them. Inferred or ambiguous requirements remain a later, separately labeled layer.

Task-file bytes must be valid UTF-8 before parsing. Invalid sequences are rejected
rather than replaced with U+FFFD, which could otherwise change an explicit path
requirement. Valid replacement characters and a leading BOM remain intact, and the
original bytes, not a re-encoded string, supply the task digest. The shared bounded
reader for task/configuration/benchmark/adjudication files opens nonblocking before checking
the descriptor's regular-file type, so a writerless FIFO or a link to one does not
wait for a writer. Links to regular files remain accepted; this is not an input-path
confinement guarantee, filesystem I/O deadline, or defense against hostile host mutation.

Policy YAML, benchmark corpus JSON and adjudication JSON also reject invalid UTF-8
before structural parsing. The strict decoder preserves BOMs and literal U+FFFD;
format-specific parsing still applies (JSON does not accept a leading BOM). Accepted
UTF-8 input round-trips byte-for-byte for source hashing instead of hashing a lossy
replacement-decoded representation. Policy decoding occurs before any configured
command executes. Benchmark corpus reads now enforce the 5 MiB bound during reading,
not only before/after an unbounded `readFile`; they retain non-empty input validation.
These guarantees do not authenticate reviewer identity or establish semantic labels.

Leaderboard compilation additionally limits the full read set to 64 MiB, including
manifests and repeated report reads. It reads one report at a time, retaining scalar
ranking metrics instead of every parsed report, and refuses malformed UTF-8 even when
the submitted digest matches those malformed bytes. Per-file read limits are clamped
to the remaining aggregate budget. A rejected compilation produces no partial ranking.
This reduces input-driven allocation/concurrency risk; it is not an OS memory quota,
runner authentication, or proof that submitted verdicts are true.

Baseline, history, override and override-source-report JSON use the same strict
decoder and bounded nonblocking regular-file reader. Invalid UTF-8 fails rather
than changing run IDs, actor names or finding identities, even if an override's
declared digest correctly matches malformed source bytes. History selection fails
on a malformed candidate rather than treating its replacement-decoded fields as
compatible. Baselines and override inputs reject writerless FIFOs before waiting
for data. Valid literal U+FFFD is not itself an encoding error.

Signing and signature verification also require valid UTF-8 report/signature JSON.
Report, key and detached-signature reads enforce their byte limits while reading;
keys remain raw buffers for cryptographic parsers, not text-normalized inputs.
Existing root/key-location/permission rules remain in force. These changes do not
authenticate override actors or key ownership, eliminate path-check/open races on
a hostile host, or impose aggregate budgets on all other evidence-directory scans.

Disposition metrics and calibration evidence also use bounded nonblocking reads
and strict UTF-8 before parsing outcome events, human missed-finding labels and
their source reports. The outcome, report-corpus and missed-label directories now
reject non-regular entries named `*.json` instead of silently ignoring them and
publishing a smaller apparent sample set. Unrelated non-JSON entries remain ignored.
Missed-label report scans enforce the same 10,000-JSON-entry bound as outcome corpus
scans. These guards do not establish a representative denominator or authenticate
human labels. Outcome metrics now share a 64 MiB aggregate input budget across
disposition events, report-corpus scans, missed labels and every referenced report
reread. Calibration has a separate 64 MiB budget covering both evidence directories
and its benchmark corpus/adjudication packet. Repeated reads are charged again;
scanning the same corpus in two phases does not reset the budget. Exhaustion throws
instead of returning partial metrics. Standalone benchmark runs retain per-file
bounds rather than implicitly sharing another command's budget.

Leaderboard, outcome and calibration reads use one shared budget implementation.
Reads are clamped to remaining allowance; capacity is reserved before I/O so
concurrent requests cannot overspend it. Successful short reads refund unused
reservation; failed reads retain it. One extra probe byte can detect a growing file
exceeding its read limit. These are accepted-input byte limits, not a process-memory
quota, CPU/filesystem deadline, or aggregate quota on all other commands. Large
evaluations require explicit partitioning; no silent truncation or automatic sample
selection is performed.

Leaderboard validation now independently recomputes the verdict implied by active
findings and checks ranking-relevant structure, unique identities and typed metadata.
A truthy string/object cannot stand in for a causal flag or a complete disposition.
Causal reproduction counts require boolean claims consistent with the recorded
head result and base-failure classification, including resource/cleanup/accounting
failures and known non-execution backends. Candidate manifest entries with invalid
file types fail rather than disappearing from the candidate set. This is internal
consistency validation only, not full schema validation, authorization of historical
suppression/override metadata, authenticity of execution, or semantic correctness.
Comparability additionally requires each task's reports to share the same declared
configuration digest, review scope and (for base scope) base-reference string and
full resolved comparison commit. Missing
context is not a wildcard. Output exposes these per-task bindings in sorted
`suite.reviewContexts`; differing policies across different tasks remain allowed.
The resolved commit must match causal base evidence, and old base-scope reports
without it cannot silently stand in for current reports. This does not authenticate
that the declared policy/runner actually executed.

Base-scope capture resolves the requested reference and HEAD to full commit IDs,
requires a unique merge base, and uses those immutable comparison operands for both
patch bytes and the changed-file list. JSON records `repository.baseCommit` (the
effective merge base), `baseReferenceCommit` (the requested ref's initial target),
and `postCheckBaseReferenceCommit`. Causal worktrees use the captured merge base,
not a fresh lookup of the mutable ref. Post-check diff capture reuses that base
while checking the current head; reference-target drift independently triggers the
core repository-mutation blocker even if diff/head hashes did not change. Ambiguous
criss-cross histories require an explicit common ancestor. Automatic history matching
also includes the effective base commit. Missing/deleted refs or unavailable objects
fail closed. This pins comparison identity, not hostile-host object availability or
the contents executed by local checks from an immutable snapshot.

Local base reviews now require clean tracked working-tree and index state against
the resolved head before any check runs. Index-only staged changes are also rejected,
as are assume-unchanged, skip-worktree/sparse and other non-normal cached index tags
that could hide dirty files. Submodule changes are not ignored; on POSIX, executable
mode differences are checked even if `core.filemode=false`. Commit tracked changes
before using `--base`, or use default working-tree review for uncommitted work. Git
flags are never silently changed or cleared by verification.

After checks, JSON includes `repository.postCheckTrackedState`. Dirty/hidden tracked
paths independently trigger a core mutation blocker even when the committed diff did
not change. This is pre/post validation, not a private immutable execution snapshot:
untracked/ignored helpers, dependencies and changes introduced then restored between
observations can still influence local checks. Head-snapshot isolation remains an
explicit plan item; these guards must not be advertised as complete execution binding.

Outcome and missed-finding events now share the descriptor-rooted output boundary,
but use a separate immutable-publication operation rather than report replacement.
It refuses `.git` paths and linked directory ancestors, writes/syncs a private staged
file, then hard-links complete bytes into the final name without replacement. Existing
regular files, hardlinks, symlinks and directories all prevent publication; duplicate
concurrent writers cannot overwrite each other. Temporary links are removed on normal
success/failure. This requires hard-link support and does not enforce host-level
append-only storage, directory-entry crash durability, post-crash staging cleanup or
isolation against hostile same-user host mutation. Non-Linux traversal retains the
weaker ancestry-check fallback documented for report output.

Top-level markers may be indented by up to three columns. Continuations at or beyond
the marker's content column are joined with newlines into the same requirement;
nested numbered/bullet clauses therefore do not acquire duplicate top-level IDs.
For `1. text`, align continuations with three spaces; `10. text` needs four. Tab
indentation uses four-column stops. Under-indented non-list continuation text fails
with an alignment error instead of silently disappearing. The 16 KiB requirement
limit applies to the complete joined UTF-8 text, not each line separately. The ID,
starting source line and top-level `[confirm]` marker remain those of the parent.
Path/check/symbol mapping and role inference see all retained clauses.

This is a documented Markdown subset, not a full CommonMark parser. Unindented prose
terminates continuation (lazy paragraph continuation is not supported), headings end
the active item, and fenced examples remain excluded while following indented prose
can continue the parent. Unattached four-space numbered blocks are not top-level
requirements. Unclosed code fences fail task preflight with the opening source line,
even when an earlier strict-coverage directive was found. This is intentionally
stricter than Markdown renderers that accept a fence continuing to end of document:
review must not silently omit subsequent requirements due to a missing terminator.
Within a retained body, indented text is task content; use fenced
blocks for code examples whose annotations must not become requirements. The content
column convention follows [CommonMark list indentation](https://spec.commonmark.org/0.31.2/#list-items),
but retaining the text does not establish that the implementation satisfies it.

Paths explicitly annotated as ``change:path`` inside requirements are mapped to the observed changed-file set. Every annotation in a requirement must match at least one changed file; partial coverage remains `missing`, and the unmatched references are recorded. Ordinary code-formatted paths remain context and are not treated as mandates. This mapping proves only that named paths changed, not that behavior is correct or the requirement is satisfied. Requirements without change annotations remain `unmapped`; AgentShip does not guess.

Explicit paths now include extensionless root names (`Dockerfile`, `Makefile`), dotfiles,
internal spaces and literal route brackets. One leading `./` and Windows-style separators
are normalized; surrounding annotation padding is trimmed. Paths must be repository-relative
and at most 4,096 UTF-8 bytes, without absolute/drive/URL forms, empty/dot/parent components,
or unsupported star patterns. A trailing `/**` is allowed only for change-directory
annotations, not symbol paths; other paths match literally. Check references are limited
to the configured 128-character identity bound. Symbol identifiers retain the existing
ASCII identifier grammar.

Recognized single-backtick evidence annotations that are empty, unsafe, malformed,
multiline or unclosed now fail task preflight with the parent requirement ID, before
repository commands run. This intentionally replaces the old silent-ignore behavior.
Annotation discovery respects whole code spans: multi-backtick or escaped examples and
ordinary code containing annotation-like text are context, not additional mandates.
Use double-backtick examples when describing invalid syntax. Unknown prefixes are
still ordinary text, and syntactic validation is not proof of behavioral coverage.

Checks explicitly annotated as ``check:name`` are mapped after execution to the captured status of the identically named configured check. Every check annotation must resolve to a passing check; failed, timed-out, and unconfigured names are recorded as unsatisfied evidence. A passing check proves only that the recorded command exited successfully for the reviewed diff. It does not prove that the check exercises the requirement or that the behavior is correct.

Symbols explicitly annotated as ``symbol:path#identifier`` are matched only against added or deleted lines in the captured unified diff for that exact path. The report distinguishes an unchanged file, a changed file without the symbol token, and changed content unavailable to the diff mapper. Binary and untracked working-tree content may be unavailable. A match proves only that the identifier token appeared on a changed line; it does not prove which declaration it names, that its behavior changed correctly, or that all changes to the symbol were captured.

Path attribution decodes the [standard Git patch path format](https://git-scm.com/docs/diff-format):
C-quoted UTF-8/octal bytes, escaped quotes and Git's optional tab separator are handled
without trimming filename spaces or stripping a leading BOM code point. Malformed
escapes, invalid UTF-8 and raw controls in quoted fields are rejected. Decoded paths
must belong to the separately captured changed-file set; ambiguous header paths can
be resolved by explicit file metadata, not guessed from source text. Hunk lines cannot
redirect file ownership. Binary deletions retain deletion metadata but no invented
symbol lines; pure renames similarly do not prove a symbol token changed. Multiple
records for a Git type change retain all changed lines and the final deletion state.
Repeated records append to the existing observation rather than repeatedly copying
its accumulated lines. Combined merge diffs and arbitrary non-Git patch formats are
not normalized into this evidence model. This strengthens filename attribution only,
not declaration ownership, runtime behavior or semantic requirement coverage.

The separate NUL-delimited changed-file lists are captured as raw bytes and decoded
with fatal UTF-8 validation, preserving filename BOMs and whitespace. Working-tree
(including untracked names), staged and base comparisons refuse invalid UTF-8 names
rather than replacing bytes and potentially attributing a change to a different file.
This intentionally excludes repositories whose changed filenames cannot be represented
as UTF-8. A valid literal replacement character remains allowed in tracked filenames;
untracked manifests retain their stricter ambiguous-path rejection.

For requirements without an equivalent explicit path annotation, AgentShip conservatively infers test or documentation file roles from imperative phrases such as “add regression tests” and “update the operator guide.” It checks only whether a changed path has the inferred role and labels the result `inferred_observed` or `inferred_missing`. Common negations are suppressed. These heuristic results are warning-level inferred evidence: a matching file does not prove adequate coverage, and unmatched wording or unconventional repository layouts can cause misses or false positives.

Files explicitly marked deleted by captured Git diff metadata are excluded from
inferred roles, and the task document itself is excluded from role matching during
review. JSON and Markdown retain `excludedDeletedFiles`/`excludedInputFiles` when
present, so a removed test or edited task cannot silently masquerade as added test
or product-documentation work. Replacement paths still count. This is not a
content/existence oracle: inputs without recognized deletion metadata retain path-only
inference, and a retained empty/comment-only file can still match. Explicit `change:`
annotations intentionally continue accepting deletions; `symbol:` remains changed-line
token evidence, including removals, comments and strings. The separate four-case
`fixtures/intent/destructive-role-corpus.json` uses file oracles for deletion and
replacement regression coverage, not representative semantic accuracy. Existing
12-case and frozen external snapshots are not overwritten by this regression suite.

The report also lists changed files not matched by any explicit change annotation. These files are **unattributed**, not proven unrelated. This reverse-coverage view is evidence for human review and does not produce a finding by itself.

Human-readable Markdown is a separate display boundary. Task prose, paths, check labels,
commands, finding titles, and operator-supplied reasons are normalized and encoded before
they enter fixed report prose, tables, or code markup. This prevents those values from
creating apparent AgentShip headings, columns, links, or raw HTML. The underlying JSON
and SARIF preserve structured evidence; other consumers remain responsible for encoding
it for their own output context. Before parsing, a task must be a regular file no larger
than 256 KiB. The parser accepts at most 256 uniquely numbered requirements, bounds each
requirement to 16 KiB, normalizes numeric identities, and ignores fenced Markdown content
when recognizing sections or the strict-coverage directive. An adversarial fixture corpus
retains hostile markup and bidirectional characters as structured task data while proving
that duplicate, empty, oversized, and fence-injected structures fail closed or remain inert.

Model prompts are a separate probabilistic boundary. Production audit, research, and MCP
call sites construct messages through one helper: fixed application instructions remain in
the system role, while the caller objective and all reference material are serialized as a
single-line JSON envelope. Only `task` defines the caller objective; source, diffs, task
context, documents, prior model answers, and other derived text live under `data` and are
explicitly declared non-authoritative. Caller-supplied topology labels are normalized to an
allowlist before use. An adversarial corpus places role-like prose, markup, fences,
bidirectional text, and JSON-looking delimiters in source, test-output, policy,
repository-instruction, and prior-model-output surfaces, and verifies that they round-trip
only as string values and never enter the system message. This is defense in depth, not a security proof: models can still
misinterpret data or follow injections, so their verdicts remain inferred claims and cannot
satisfy deterministic checks or approve a gate.

A task containing the exact `<!-- agentship: strict-change-coverage -->` directive turns unattributed files into a warning-level finding. The task document itself is excluded because it is review input rather than implementation output. Only explicit path mappings satisfy strict attribution; inferred roles cannot hide an unattributed file. The directive is task-owned and warning-only, so it is not an immutable repository policy and is not sufficient for hostile pull-request enforcement.

A requirement prefixed with `[confirm]` blocks gate-mode review until its stable requirement ID is supplied through `--confirm`. The report records whether confirmation was required or supplied. This is an explicit local operator assertion bound to the task and diff hashes; it is not authenticated identity, a signature, or attested approval. AgentShip does not infer ambiguity from unrestricted prose.

Requirements with observed file or symbol evidence under a configured `protectedPaths` entry whose `requireManualApproval` flag is true also require `--confirm`. The report records `protected_path` as the basis. Version 1 accepts only exact repository-relative paths and trailing `/**` directory patterns. This makes high-impact classification deterministic, but the local assertion is still unauthenticated and the repository-owned policy can be changed in the same patch. Immutable policy loading and signed approvals remain policy-gate work.

Independently of task mapping, every observed changed file is matched against repository `protectedPaths`. A matching entry with `requireManualApproval: true` produces a blocker until the operator supplies the exact configured pattern through repeatable `--approve-path` arguments. Unknown patterns and duplicate policy identities are rejected. JSON and Markdown evidence retain the pattern, matching files, approval state, configuration hash, and reviewed diff hash. This closes the task-annotation bypass but remains a local unauthenticated assertion; explicit mapped requirements retain their separate `--confirm` decision.

Metrics from the explicit-evidence fixture corpus describe only deterministic annotation handling. They must not be presented as semantic missed-requirement recall; that requires a separate real or seeded defect corpus with independently known outcomes.

The initial seeded omission corpus is a deliberately small, synthetic calibration set with independently labeled outcomes. Its eight cases currently produce 0.80 precision, 0.80 recall, and one-third false-positive rate for omission detection. These values expose current blind spots; they are regression baselines, not publishable product-performance claims. In particular, behavior-only semantic omissions remain undetected and stale explicit annotations can create false positives. A representative external corpus is still required.

The primary executable corpus contains 12 declarative before/after patch cases. AgentShip applies each patch in memory, derives changed paths and a line-level unified diff, and executes bounded file-existence/content oracles to determine the outcome independently of the detector. It never executes corpus-provided shell commands. The current executable baseline is 0.667 precision, 0.667 recall, and one-third false-positive rate. Its false negatives include behavior-only security and documentation-content omissions; false positives include stale path annotations and unconventional test layouts. The corpus is still synthetic and small, so these metrics remain engineering baselines rather than publishable real-world accuracy.

The `benchmark --fixtures` command validates corpus paths, size bounds, schema, and unique case identifiers, then emits the source SHA-256, aggregate confusion-matrix metrics, every case result, and executable oracle outcomes where present. The standalone executable requires an explicit corpus path; it does not embed a favorable corpus, execute corpus code, or call a model. Corpus provenance and representativeness remain the benchmark publisher's responsibility.

Externally evaluated candidates use a distinct `external_evaluation` schema. It requires
an immutable dataset revision, exact dataset-export and predictions-file hashes, credential-free HTTPS source, deterministic selection
description, retrieval date, and a unique instance/candidate identity bound to repository,
full base commit, exact candidate-patch and outcome-report hashes, and outcome evidence. The benchmark retains those fields but does not
fetch them, authenticate the named candidate, rerun the external evaluator, or prove that
selection was followed. A representative result still requires independently produced
candidates and a published sampling method; see `docs/EXTERNAL_CORPUS.md`.

The first public-artifact pilot uses 20 candidates selected by repository and instance
identity before outcomes were read, from immutable dataset and submission commits. Raw
material stays local; a checked-in summary retains the selected identities, byte hashes,
and detector results. None of the downloaded code is executed. Published task-resolution
outcomes are external claims and a proxy for incomplete work, not independently verified
semantic omission labels. The original pilot has zero recall on five unresolved candidates
and one flag on a resolved candidate. A clause-aware heuristic repair removes that flag on
the development set, and a subsequently evaluated, preselected disjoint holdout detects
one of three unresolved candidates with zero flags on 13 resolved candidates. Both
summaries are retained; neither establishes publishable accuracy. Inferred role matching
remains warning-level evidence and does not prove semantic behavior. Empty
predicted-positive denominators emit `null` precision rather than a perfect-score convention.

The machine-readable measurement boundary enforces this distinction as well: benchmark
output derives `labelSemantics` from corpus kind; external task outcomes always use
`task_resolution_proxy`, and conflicting semantics declarations are rejected. Calibration
never fills `recall.omissions` from this proxy class, exposing `recall.taskResolutionProxy`
instead. Declared omissions and file-oracle omissions retain separate semantics without
claiming independent semantic adjudication. Rates with absent denominator classes remain
`null`; missing evidence must not appear as perfect detection performance.

## CI report boundary

The subject GitHub workflow uses the unprivileged `pull_request` event with `contents: read`, no repository secrets, blank CLI token variables, a GitHub-hosted disposable runner, and full-commit-SHA-pinned official actions. A minimal caller pins the reusable AgentShip verifier workflow to an immutable commit. That verifier checks out three distinct trust roots: its own executable and task extractor from the pinned AgentShip revision, repository policy from the target repository's base revision, and the exact pull-request subject under review. Pull-request changes cannot replace the verifier or effective policy for that run. The PR title/body is passed as data through the GitHub event file, never interpolated into a shell program. JSON, Markdown, and SARIF reports are uploaded as artifacts, and the Markdown is copied into the workflow job summary.

A separate default-branch `workflow_run` publisher holds `checks: write`,
`attestations: write`, and `id-token: write`. A minimal caller pins the reusable publisher
workflow to an immutable AgentShip commit; the publisher checks out only that trusted publisher code,
downloads the named artifact from the exact triggering run, and treats every artifact
byte as untrusted data. The parser bounds both event and report, requires one
event-associated pull request, verifies repository and base bindings, and selects the
Check Run head exclusively from the trusted workflow event. After validation it writes
fresh canonical JSON, uses a full-SHA-pinned GitHub action and short-lived Sigstore
certificate to attest those exact bytes, and uploads the JSON plus verification bundle.
The result is always `neutral`, including for a BLOCK report, so it cannot serve as a
policy gate. The publisher does not execute artifact contents or write comments, labels,
source, releases, deployments, code-scanning results, or merge status. The attestation
authenticates publisher workflow identity and report digest, not subject-runner claims or
finding truth.

Repository policy treats `.github/workflows/**` as a protected path requiring explicit
local approval. Operators must not configure the neutral publisher Check Run as a
required branch-protection check; doing so would confuse report delivery with approval.

The subject's configured checks execute hostile repository code inside disposable bubblewrap workspaces on a GitHub-hosted runner. A trusted-base installer fetches one fixed Ubuntu Noble amd64 package, checks its published SHA-256 before installation, rejects setuid/wrong-version binaries, and smoke-tests namespace creation. Every check gets a fresh network namespace. The Next build uses pinned Geist v1.7.2 variable assets with fixed hashes and the SIL Open Font License stored in the repository, removing its former Google Fonts fetch. This remains suitable only for secretless, read-only reporting on GitHub-hosted disposable runners. It is not safe for self-hosted runners, privileged subject triggers, subject write tokens, secrets, or merge gating. GitHub repository settings can also opt into write tokens or secrets for fork workflows; operators must leave those options disabled. The incoming unsigned artifact may be attacker-influenced despite the trusted verifier, which is why the privileged publisher only validates and attests a fresh canonical copy and emits a bounded neutral summary. Live fork-PR validation remains required before the workflow is marked fully delivered.

Base-owned `whenChanged` patterns select checks using only exact repository paths and trailing `/**` directory patterns. A non-applicable check is recorded as `skipped`, never as passing; a task that explicitly requires that check remains unsatisfied. Base-owned changed-file and diff-byte limits produce a blocker and skip repository commands before an oversized review executes. Per-check and workflow wall-clock timeouts are enforced. The official Linux policy additionally applies per-process CPU-time, file-size, and descriptor limits through `prlimit`; a 1024 MiB sampled writable-storage budget covers the disposable workspace and private `/tmp`; and bubblewrap supplies PID/filesystem/network namespaces. A configurable address-space bound exists but is omitted for official Node checks because it is not a reliable resident-memory bound and breaks runtimes that reserve large virtual ranges. Aggregate process-tree CPU/memory accounting, hard disk-capacity quotas, process-count limits, host-kernel isolation, and dependency installation with network access outside the worker remain residual risks.

Opt-in causal checks require an explicit base revision and bubblewrap. After a head pass,
AgentShip creates a detached merge-base worktree, overlays only changed regular files
matching trusted `causal.testPaths`, and reruns the command in a fresh sandbox while
sharing the head installation's dependencies. A base run qualifies only when it has
status `failed`, no termination signal, an integer exit code in 1–125, and no recorded
writable-storage/accounting or workspace-cleanup failure. Zero exit is never a
reproduced regression, even if cleanup or resource monitoring made the run fail.
Shell codes 126 and above are conservatively rejected as ambiguous execution/signal
outcomes, including deliberate test exits in that range. This follows the reserved
status conventions in the [POSIX shell specification](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html#tag_19_08_02).
The report retains `causal.reason`, the underlying base execution evidence, and the
blocker's `baseFailureReason`; workspace removal failure is separately recorded as
`execution.cleanupFailed`. Base pass, timeout, or recognized infrastructure failure
is a core blocker regardless of a precomputed `satisfied` flag.

This establishes revision discrimination for the declared overlay, not test semantics
or dependency causality. In particular, syntax, redirection, assertion, dependency
startup and arbitrary program failures can share codes 1–125. A normal nonzero exit
is not proof that the intended assertion ran or failed. Commands can also mask errors
or signals with their own exit codes; this assessment cannot recover hidden causes.

Overlay preparation runs on the host before sandbox execution, so it has its own
path boundary. On Linux it pins source/destination directories through open directory
descriptors and `/proc/self/fd`, opens each repository-controlled component with
`O_DIRECTORY | O_NOFOLLOW`, and opens source files without following links. It rejects
symbolic-link ancestors/leaves, non-regular and multiply linked source files,
unnormalized paths, filesystem roots and administrative `.git` components. Destination
updates use exclusively created temporary files plus atomic rename, not truncation
of an existing inode; destination hardlinks therefore do not alter their other names.
Missing source files remove only a validated counterpart entry. Executable permission
bits are retained, but setuid/setgid bits are not. These operations use the
[Linux no-follow/directory-descriptor semantics](https://man7.org/linux/man-pages/man2/open.2.html).

Preparation accepts at most 256 unique selected paths, 16 MiB per file and 64 MiB
of copied bytes with fixed 64 KiB buffers. Observed source size/timestamp changes
abort copying; temporary entries and descriptors are cleaned up, and the detached
worktree is removed by the caller on failure. Rejection currently fails the command
rather than fabricating a completed verification report. This requires ordinary Linux
procfs descriptor access and deliberately refuses linked test fixtures even when a
link would stay inside the repository. It does not defend against a same-UID hostile
host process relocating directories, mount replacement, compromised Git/runtime, or
kernel attacks. Source/base roots and host namespace ownership remain trusted; this
does not complete adversarial maintainer-mode isolation.

Repository-owned suppressions match an exact finding ID and warning kind. Each entry has a stable suppression ID, owner, reason, and calendar-date expiry. An active suppression is attached to—not removed from—the finding, is represented as an accepted external SARIF suppression, and removes only that warning's verdict impact. Expired entries are ignored. The schema rejects blocker kinds, duplicate identities, duplicate targets, invalid dates, and unbounded ownership/reason text.

Repository-owned `policy.blockOn` entries promote named warning finding kinds to blockers. The schema accepts only implemented finding kinds and rejects duplicates, and the effective configured list is captured in JSON and Markdown evidence. Promotion happens before suppression, so a configured blocker cannot be suppressed through the warning-exception mechanism. Findings that protect evidence integrity—required check failure or timeout, repository mutation, exceeded review budgets, and missing required confirmation—remain blockers independently of this list. Report mode records a `BLOCK` verdict without changing the process exit code; gate mode enforces the verdict.

In the fork workflow, suppressions come from the separately checked-out base policy, so a pull request cannot suppress itself. In local working-tree mode, `.agentship.yml` may change in the same diff and remains developer-trusted; suppression there is not immutable approval, authenticated identity, or an override attestation. Policy immutability and signed actor-bound overrides remain M5 work.

Overrides are supplied as bounded JSON records after an initial unmodified review. Each record names a stable ID, claimed actor, bounded reason, calendar-date expiry, exact finding identities, and the path and SHA-256 of the source report. AgentShip verifies the source bytes and requires the source report's head, diff, configuration, and optional task hashes to match the current review. Targets must be present in both reports. Accepted overrides remain attached to findings and appear as external accepted suppressions in SARIF; they do not delete evidence. Repository mutation, review-budget, missing-confirmation, and protected-path-approval findings cannot be overridden. The actor field is still a claim—not authenticated identity or a signature—and CI must load override records from a trusted revision before they can safely affect a gate.

A baseline is an optional prior AgentShip JSON report supplied through `--baseline`. AgentShip reads it as bounded data with a 5 MiB file limit, a 10,000-finding limit, required schema/run/commit metadata, bounded identity fields, and duplicate rejection. It binds results to the baseline SHA-256 and compares exact finding ID/kind pairs. The comparison labels findings new, existing, or resolved but does not suppress findings or affect the current verdict. Baseline selection, provenance, and retention are not yet automated or attested.

Opt-in local history automates compatible baseline selection and retention. AgentShip accepts only a repository-child history directory, bounds it to 1,000 entries, rejects malformed or oversized reports, and selects the newest candidate with identical configuration SHA-256, task SHA-256, review scope, and base reference. It writes JSON, Markdown, and SARIF only after checks and repository-stability capture complete, so ignored history output is not part of the reviewed diff. CI restores only from a PR-scoped cache namespace under explicit read-only access. The separate publisher validates workflow, repository, PR/base, report scope, hash fields, and bounds before canonicalizing and attesting one report, then saving it with explicit write-only access. Cache misses and incompatible history are non-fatal, and comparison remains unable to alter verdicts. Cache restoration does not retrieve or verify the attestation, so restored bytes remain untrusted informational input and namespace isolation still depends on repository workflow governance.

Finding outcome events bind an exact finding identity to the SHA-256 and execution context of its source report. Accepted and rejected events are explicitly human dispositions. Fixed events additionally require a compatible later report in which that identity is absent, while overridden events require the source finding to retain validated override evidence. Files are bounded and exclusively created inside the repository, but actor strings remain unauthenticated and local event files are unsigned. Metrics derived from them inherit that provenance limit and should use trusted artifact storage.

Calibration recomputes metrics from three bounded inputs: a complete review-report denominator, outcome events whose source and resolution bytes must occur in that denominator, and a freshly executed intent benchmark. Exact source-report and finding identities group lifecycle events; conflicting confirmed/rejected dispositions fail closed. Aggregate directory hashes, corpus hash, formulas, and sample sizes make the result reproducible. This does not authenticate actors, prove that the supplied report directory is complete, or make a synthetic corpus representative. Trusted append-only collection and representative external corpora remain operator and M3 responsibilities.

Missed-finding labels separately bind a human-identified omission to exact report bytes and are rejected if that identity was emitted. A completed-audit record binds the report and digest of its exact current label set, including an empty set. The separate `outcome-metrics` command calculates recall only for completed audits in an explicitly supplied, hash-verified review corpus, using accepted/fixed findings from those reports as true positives and their missed labels as false negatives; it also reports audit coverage. The tool does not authenticate auditors, establish their independence, reproduce the claimed defect, or prove that the audited sample is representative; those remain benchmark-governance responsibilities.

Leaderboard compilation accepts bounded manifests that bind a declared agent/model and
suite to exact task and report hashes. It rejects incomparable task sets and ranks without
timestamps or model calls. This establishes reproducible aggregation, not agent identity,
report authenticity, complete submission collection, or corpus representativeness.

The fork workflow loads protected-path policy from the separate target-base policy checkout, so pull-request changes cannot weaken the effective policy used for that run. Local working-tree reviews still trust the mutable checkout policy. Authenticated approvals and signed override records remain later provenance work.

The trusted-policy boundary is covered by an executable regression: a subject modifies its own `.agentship.yml` from gate mode to permissive report mode, removes protected paths, and substitutes a passing check, while AgentShip loads an external base-owned configuration. The resulting report retains gate mode and emits both the trusted required-check failure and protected-path blocker. The official workflow separately asserts that it never passes subject-controlled `--approve-path` or `--override` inputs. This proves precedence for the checked-in workflow structure; GitHub settings and live fork behavior remain external deployment assumptions.

## Repository-state integrity

AgentShip captures the Git head and diff digest before and after executing checks. Any difference is a blocker because command results would otherwise describe a different repository state from the one named by the report. This detects mutation; isolated read-only execution remains a later maintainer-mode control.
