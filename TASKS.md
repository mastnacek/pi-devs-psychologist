# TASKS — pi-devs-psychologist

Sequenced roadmap. Every task carries its own validation; a task without a
runnable check is not a task.

Status marks: `. ` todo · `/ ` working · `x ` done · `? ` idea

---

## x T1 — Repo + observation kernel

Git repo in the workshop shape, VSA layout, and the objective substrate the whole
plugin rests on: session events → a bounded observation window → arithmetic
signals.

**Delivered:** `src/shared/{signals,lexicon,state,config,i18n,status,version}.ts`,
`src/slices/observer/index.ts`, `index.ts` composition root with the subagent
recursion guard and an idempotent `session_shutdown` drain.

**Validation:** `npm test`, including a hand-counted fixture asserting 3 tool
failures out of 8, 1 restatement, 1 churn file, 1 verified run, 3 turns since
verified progress. `npx tsc --noEmit` exits 0.

---

## x T1b — Session history fold

The whole session as a structural record, from `sessionManager.getBranch()`:
operator cancellations (`stopReason: "aborted"`), provider errors, output-limit
cutoffs, model switches, thinking-level raises, compactions and the largest context
that forced one, abandoned `/tree` branches, context removals vs rewrites, live
`/label` bookmarks, the declared session name, human wait times, and the
prompt-cache read share.

**Delivered:** `src/shared/history.ts`. The study and its refusals are in
`docs/session-data.md`; the data boundary is a design rule in PRD §4.1 (no message
bodies, no system or skill sections, no reasoning text, no peer plugin state, no
cost totals, no cross-session history).

**Validation:** `npm test` — 51/51. The fixture asserts exact counts and the
evidence array is asserted element-for-element, so a line that starts interpreting
fails the suite. Tests pin that `getBranch()` is used and `getEntries()` is not,
that cleared labels are excluded, that cache-warm usage does not move the ratio,
that unknown entry types are ignored, and that a burst of prompts does not restart
the wait clock.

---

## x T2 — Nested model call

`src/shared/model-call.ts`: resolve the configured `provider/modelId` against
`ctx.modelRegistry`, take auth via `getApiKeyAndHeaders`, call
`registry.complete(...)` with a `completeSimple(...)` fallback, and return plain
text plus usage. No slice may call a model directly.

**Validation:** test with a fake registry asserts the exact request built from
evidence lines; a missing key returns a typed failure rather than throwing into
the session; usage is propagated.

---

## x T3 — The psychologist prompt + structured appraisal schema

`src/shared/prompt.ts` (English, model-facing) and `src/shared/appraisal.ts`:
the system prompt and a TypeBox schema (`StringEnum`, never `Type.Union`) for the
appraisal — needs (autonomy / competence / relatedness) each with cited evidence,
cognitive-load drivers, progress, flow breaks, open loops, and **`interventions`
of length 0 or 1**.

The appraiser's input is **two** evidence sets, and the prompt must say so: the
live window (`signals.evidence`, what just happened) and the session history
(`history.evidence`, the whole record). A citation may come from either, but every
citation must match a supplied line verbatim — the schema cannot be satisfied by
paraphrasing one. `readHistory(ctx)` is read at appraisal time rather than cached,
so the branch is always the one the operator is actually on.

**Validation:** schema rejects an appraisal carrying two interventions, one with
no citation, or one citing an evidence line that was not supplied. Prompt is
asserted to contain the no-score and cite-or-silence rules.

---

## x T4 — Cadence, budget and single-flight policy

`src/slices/appraiser/index.ts`: an appraisal fires on `turn_end` when
`turnsSinceAppraisal >= cadenceTurns`, only while `budgetAvailable()`, never while
one is in flight, and never in `json`/`print` modes.

**Validation:** over 30 simulated turns with `cadenceTurns: 8` and a cap of 3,
exactly 3 model calls occur; a slow fake in flight suppresses the next one.

---

## x T5 — Intervention policy and delivery

`src/slices/interventions/index.ts`: map an appraisal to at most one delivery —
a TUI note (default) or, when `steerAgent` is true, one line into the working
agent's context. `name_next_win` deliberately delegates to `pi-quick-win`'s tool
through prompt policy rather than code.

**Validation:** test asserts two interventions never render, `steerAgent: false`
never touches the agent's context, and an empty appraisal produces silence.

---

## x T6 — `/psych` command and report

`src/slices/report/index.ts` + `src/slices/commands/index.ts`: the report from
`src/shared/i18n.ts` copy, width-safe (`visibleWidth` / `truncateToWidth`), and
`getArgumentCompletions` following the Trailing Space Contract — non-terminal
`model`/`budget`/`lang` get a trailing space; terminal choices do not.

**Validation:** completions test asserts exact `value`/`label` pairs per level;
render test asserts no line exceeds the mocked terminal width.

---

## . T7 — Persistence **(partially done: appraisal restore shipped with T16)**

Store the last appraisal as a TUI-only entry via `pi.appendEntry` and restore it
on `session_start`, so `/reload` and compaction never lose a report — and never
let an appraisal re-enter the observation window.

**Done in 0.4.0 (T16):** the last appraisal is appended as a `psych-appraisal`
`custom` entry and `restoreAppraisal` reads it back on `session_start`; the outcome
ledger uses the same mechanism. `persistence.test.js` asserts restore returns the
same appraisal and contributes zero observations.

**Remaining:** none identified beyond the ledger, which also persists.

**Validation:** test asserts restore-after-reload returns the same appraisal and
that restored text contributes zero observations.

---

## . T8 — Codebase mapper (no LLM)

`src/slices/mapper/index.ts`: an objective structural map of the repo the session
is working in — file sizes, slice layout, longest files, test-to-source ratio —
to give the appraiser a factual complexity figure instead of a guess. Pure
`node:fs`; no model, no watcher.

**Validation:** over a fixture tree, asserts exact file counts and the longest
file, and asserts the mapper never reads outside `cwd`.

---

## . T9 — Integration contract with pi-quick-win

The psychologist detects "long stretch, no delivered increment" and the working
agent is told to ask `pi-quick-win` for the smallest shippable increment.

**Validation:** no import between the two plugins; the coupling is a documented
prompt policy, and a test asserts neither package imports the other.

---

## ? T10 — Longitudinal, opt-in history

If — and only if — the appraiser proves useful, an explicitly opt-in local record
of *delivery events* (not moods, not scores) across sessions, so "verified
progress has thinned out this week" becomes answerable. Deliberately last: it is
the only task that stores something about a person.

---
## ? T12 — Reviewer role: the observer as pair programmer

The observer already sees *how* the work is done. Verified against the published
tool schemas: `edit` args are `{ path, edits: [{ oldText, newText }] }`, `write` args
are `{ path, content }` (the whole file), and `args` reaches extensions verbatim.
Today `slices/observer` keeps only `path` and discards the rest. The idea: run the
*work* on a model affordable in volume and the *review* on a stronger one.

Full reasoning, the two-consent-gate decision, the VSA shape and the invariants are
in `docs/adr/0001-two-roles-one-observer.md`. Not implemented, on purpose.

Subtasks, in the order they must happen:

- **T12a — Observer becomes a recorder, not a projector.** One capture serving two
  projections, with `retain: "counts" | "content"` defaulting to `counts`, so the
  data kept is a function of what is enabled. This is the only change the reviewer
  role implies to existing code, and it is a shape change, not a feature.
  *Validation:* with `retain: "counts"` no change content is retained anywhere in
  the record (asserted by walking it); with `"content"` the record stays within its
  bound on a 500-edit session.
- **T12b — Convention sources.** Adherence needs a *stated* convention. A bounded
  reader for `AGENTS.md` and equivalents, cached, never in the psychologist's path.
  *Validation:* a repo with no stated rules yields no convention findings rather than
  invented ones.
- **T12c — Bounded review sample.** Select the changed hunks worth reviewing at a
  delivery boundary (a verified run or a labelled checkpoint). Hard token cap.
  *Validation:* the sample never exceeds its cap on a large diff, and always includes
  the declared intent alongside the diff (the mismatch signal depends on both).
- **T12d — Reviewer appraisal with abstention.** Own model, own schema,
  `insufficient_context` as a first-class outcome, silence as the default.
  *Validation:* the schema rejects a finding with no citable rule; a diff with no
  convention source produces `insufficient_context`, not a guess.
- **T12e — Proposal delivery.** Findings go to the operator, never applied, never
  injected as instructions to the working agent.
  *Validation:* a test asserts the plugin performs no file mutation and never writes
  into the agent's context from this slice.

**Kill criterion (recorded up front):** if fewer than half its findings are accepted
at review time, or if it only reproduces what `pi-lens` and
`pi-architecture-watcher` already report deterministically, delete the slice rather
than tune it.

---


## . T11 — Release

`README` + `CHANGELOG` final for `0.1.0`, push, and install from GitHub.

**Validation:** `pi -e git:github.com/mastnacek/pi-devs-psychologist` loads the
extension; `pi update` reconciles it.
---

## Plan 0.4 — pi-pair principles + agent runtime

Full specifications (goal, files, behaviour, acceptance, non-goals) live in
[`docs/plan-0.4.md`](docs/plan-0.4.md); this list is the index only.

- `x T13` README truth pass (stale version, key statuses, `envFacts`)
- `x T14` Signal-triggered appraisal — deltas since last attempt, clock is a floor
- `x T15` Delivery-boundary check — commit/push with unverified changes, 0 tokens
- `x T16` Intervention outcome ledger — measures the plugin, never the person
- `x T17` Anti-nag cooldown — per-kind cooldown, mute after two no-change repeats
- `x T18` Recurring friction line from existing `FailureFingerprint`
- `x T19` Spike: child `pi` launch facts on this machine (10 questions) — results in [`docs/agent-runtime-spike.md`](docs/agent-runtime-spike.md)
- `x T20` ADR 0002 — agent runtime and the data boundary
- `x T21` Config + `--psych-runtime` flag + `/psych runtime|context|agent-model`
- `x T22` Child mode: `psych_submit` tool + read-only `tool_call` guard
- `x T23` Agent brief: role prompt, pi docs map, pi.dev/packages, web/MCP/skills/nlm
- `x T24` Runner: argv/env builder, JSONL stream, cost/time limits, tree kill
- `x T25` Schema `suggestions` with enforced sources
- `x T26` Async delivery, deliver at a natural pause, `/psych stop`
- `x T27` Accounting in `/psych`, session cost cap
- `. T28` Context level `digest` (scrubbed, no tool outputs)
- `. T29` Context level `fork` (full session, confirm on first use)
- `. T30` `/psych ask <question>`
- `. T31` Scout role — recurring friction → existing plugin or a SPAI idea
- `. T32` Pair role — revises T12, only if pi-pair leaves a gap
- `. T33` NotebookLM research grounding
