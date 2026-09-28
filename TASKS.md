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

**Validation:** `npm test` — 37/37, including a hand-counted fixture asserting
3 tool failures out of 8, 1 restatement, 1 churn file, 1 verified run, 3 turns
since verified progress. `npx tsc --noEmit` exits 0.

---

## . T2 — Nested model call

`src/shared/model-call.ts`: resolve the configured `provider/modelId` against
`ctx.modelRegistry`, take auth via `getApiKeyAndHeaders`, call
`registry.complete(...)` with a `completeSimple(...)` fallback, and return plain
text plus usage. No slice may call a model directly.

**Validation:** test with a fake registry asserts the exact request built from
evidence lines; a missing key returns a typed failure rather than throwing into
the session; usage is propagated.

---

## . T3 — The psychologist prompt + structured appraisal schema

`src/shared/prompt.ts` (English, model-facing) and `src/shared/appraisal.ts`:
the system prompt and a TypeBox schema (`StringEnum`, never `Type.Union`) for the
appraisal — needs (autonomy / competence / relatedness) each with cited evidence,
cognitive-load drivers, progress, flow breaks, open loops, and **`interventions`
of length 0 or 1**.

**Validation:** schema rejects an appraisal carrying two interventions, one with
no citation, or one citing an evidence line that was not supplied. Prompt is
asserted to contain the no-score and cite-or-silence rules.

---

## . T4 — Cadence, budget and single-flight policy

`src/slices/appraiser/index.ts`: an appraisal fires on `turn_end` when
`turnsSinceAppraisal >= cadenceTurns`, only while `budgetAvailable()`, never while
one is in flight, and never in `json`/`print` modes.

**Validation:** over 30 simulated turns with `cadenceTurns: 8` and a cap of 3,
exactly 3 model calls occur; a slow fake in flight suppresses the next one.

---

## . T5 — Intervention policy and delivery

`src/slices/interventions/index.ts`: map an appraisal to at most one delivery —
a TUI note (default) or, when `steerAgent` is true, one line into the working
agent's context. `name_next_win` deliberately delegates to `pi-quick-win`'s tool
through prompt policy rather than code.

**Validation:** test asserts two interventions never render, `steerAgent: false`
never touches the agent's context, and an empty appraisal produces silence.

---

## . T6 — `/psych` command and report

`src/slices/report/index.ts` + `src/slices/commands/index.ts`: the report from
`src/shared/i18n.ts` copy, width-safe (`visibleWidth` / `truncateToWidth`), and
`getArgumentCompletions` following the Trailing Space Contract — non-terminal
`model`/`budget`/`lang` get a trailing space; terminal choices do not.

**Validation:** completions test asserts exact `value`/`label` pairs per level;
render test asserts no line exceeds the mocked terminal width.

---

## . T7 — Persistence

Store the last appraisal as a TUI-only entry via `pi.appendEntry` and restore it
on `session_start`, so `/reload` and compaction never lose a report — and never
let an appraisal re-enter the observation window.

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

## . T11 — Release

`README` + `CHANGELOG` final for `0.1.0`, push, and install from GitHub.

**Validation:** `pi -e git:github.com/mastnacek/pi-devs-psychologist` loads the
extension; `pi update` reconciles it.