# CHANGELOG

## 0.0.5 — config that works, and config that is honest about not working yet

### Fixed

- **`lang` was dead config.** The key was validated, persisted, documented and then
  ignored: `status.ts` hardcoded `psych: off`, `psych: signals` and the budget
  format, so the locale table existed and nothing read it. The chip now renders from
  `stringsFor(config.lang)` and a regression test asserts the locale changes the
  painted text. A config key that silently does nothing is worse than no key at all.
- The chip's strings moved into the locale table where they belonged, including the
  appraisal format as a function so a locale can reorder the parts.

### Changed

- `STRINGS` uses `satisfies Record<Locale, Strings>` instead of a type annotation:
  a locale missing a key is still a compile error (verified by deleting one and
  reading the TS2741), but the literal types are no longer widened away.
- `normalizeLocale` takes `string | null | undefined` rather than `unknown`. The JSON
  boundary in `config.ts` is where unvalidated input is parsed; by the time a value
  reaches the locale table it is known to be a string or absent. The runtime guard
  stays, because a hand-written JSON file can still violate the type.

### Added

- **11 more tests (69 total).** The invariant that every locale provides every key,
  that no locale ships an empty string (a blank chip is not a translation), that an
  unknown locale falls back to English text rather than to silence, that `off` beats
  `configured` in the chip, that an unlimited budget renders as one number and not a
  fraction of zero, and that an in-flight appraisal is visible so a slow model does
  not look like a dead one.
- **A README table of every configuration key** with its default and whether it is
  live or pending. Seven of the ten keys are validated and persisted but inert until
  T3–T5 invoke the fold and the appraiser they configure; that is now stated instead
  of implied.

### Reviewed, deliberately unchanged

- `pi-lens` flags `writeFileSync` in `saveConfig` (`no-raw-json-store-write`). The
  write is already write-to-temp-then-rename, which is the atomic pattern the rule
  exists to produce; the rule matches the call, not the idiom.
- `positiveInt` / `ratio` keep their `unknown` parameters: they read a parsed JSON
  layer, so that function *is* the decode boundary the `no-unknown-parameters` hint
  asks for.

## 0.0.4 — multi-model setup: several OpenRouter accounts, three roles

Documentation only. Records how the plugin will run different models, and different
*accounts*, for the different roles.

### Added

- **`docs/models.md`** — the operator's model plan. `config.model` is a
  `provider/modelId` handle, so it selects a provider account as well as a model;
  `pi-openrouter-accounts` registers each OpenRouter account as its own provider id
  (`openrouter-default`, `openrouter-soukr`), which is how the roles get their own
  models and their own budgets.
- **Role → account mapping.** Worker on the main account. **Psychologist on the
  free-tier account** — a low-cadence observer (~7 evidence lines every
  `cadenceTurns`) is precisely the workload a free tier fits, so the second opinion
  can cost nothing extra while the work account's quota stays untouched. The
  reviewer (T12) on the main account, where capability actually pays.
- **Five rules stated in the doc:** the psychologist must not be the worker's model
  (a different account is not a different model); `onlyFree` accounts reject paid
  models at call time, and `config.model` is deliberately validated as a string only;
  evidence lines leave the machine too, so account choice is a data-policy decision
  and not only a billing one; budget isolation needs both
  `maxAppraisalsPerSession` and a separate account; account ids are never hardcoded in
  the plugin, which reads only `config.model`.
- README Configuration and PRD §3 now point at that doc.

### Notes

- Credentials stay in `auth.json`, owned by `pi-openrouter-accounts`. This plugin's
  config never holds a key, a base URL or a token source.
- Installed into the operator's settings as
  `git:github.com/mastnacek/pi-devs-psychologist`. Until T2–T4 land the plugin only
  observes and paints `psych: signals`; it spends nothing.

## 0.0.3 — the second role, decided but not built

Documentation only. No code changed, and deliberately no dead configuration was
added.

### Added

- **ADR 0001 — two roles, one observer.** The observer sees *how* as well as *how
  much*: verified against the published tool schemas, `edit` args are
  `{ path, edits: [{ oldText, newText }] }`, `write` args are `{ path, content }` (the
  whole file), and `args` reaches extensions verbatim. The plugin already receives
  all of it and keeps only `path`.
- **The decision:** the same position can also be a reviewer, on a stronger model
  than the worker, at delivery boundaries — but as a **separate role with a separate
  consent gate**. The psychologist reads counts; a reviewer reads content that can
  leave the machine. Enabling one must not silently opt into the other.
- **The VSA shape:** `slices/observer` becomes a recorder with a
  `retain: "counts" | "content"` policy so one capture serves two projections
  (`slices/psychologist`, `slices/reviewer`). This is the only change the role
  implies to existing code.
- **Seven invariants** the reviewer must satisfy, written down while they are cheap:
  proposes and never writes; abstention (`insufficient_context`) is first-class and
  silence is the default; convention adherence requires a *stated* convention, because
  you cannot check adherence to a rule nobody wrote; no style opinion without a
  citable rule; bounded output; never reviews its own model's work; findings go to the
  operator, never injected as instructions.
- **T12a–T12e** with a validation each, and a kill criterion recorded up front: if
  fewer than half its findings are accepted, or it only reproduces what `pi-lens` and
  `pi-architecture-watcher` already report deterministically, delete the slice rather
  than tune it.
- **PRD §10** and an amendment to §5 prohibition 7, which is now scoped to the
  psychologist role so the design record does not contradict the roadmap.

### Not done, on purpose

- No content retention and no `retain` key. Nothing consumes it yet, and retaining
  source code with no consumer is liability — particularly in a plugin whose stated
  discipline is refusing data it does not need.

## 0.0.2 — session history: the whole record, and its boundary

The live window sees minutes; a session is hours. This adds the structural fold
over the engine's own session entries, plus a written study of what may and may
not be read. Still no model is called.

### Added

- **Session history fold** (`src/shared/history.ts`) over
  `sessionManager.getBranch()`: operator cancellations (`stopReason: "aborted"`),
  provider errors, output-limit cutoffs, model switches, thinking-level raises and
  lowers, compactions with the largest context that forced one (engine vs extension),
  abandoned `/tree` branches, context removals vs rewrites, still-live `/label`
  bookmarks, the declared session name, human wait times, and the prompt-cache read
  share.
- **`docs/session-data.md`** — the study: every entry type and what it yields, the
  full list of refusals with reasons (message bodies, system/skill sections,
  reasoning text, peer plugin state, cost totals, cross-session history), and how
  existing workshop plugins already read the same record.
- **PRD §4.1** — the data boundary stated as a design rule rather than a habit.
- 14 more tests, including exact element-for-element assertion of the evidence
  array, so a history line that starts interpreting fails the suite.

### Fixed

- The session span is now scanned across all entry timestamps instead of read from
  the first and last entry. A single malformed timestamp in the tail used to
  collapse the span to zero and quietly under-report the session's length.

### Notes

- `getBranch()` is used deliberately; a test asserts `getEntries()` is never called,
  because after `/tree` it would count abandoned work as session progress.
- Unknown entry types are ignored rather than rejected, so a future engine version
  adds a type instead of breaking the appraiser.

## 0.0.1 — observation kernel

First increment. The plugin exists as a repo and the layer everything else will
read from is landed and tested. No model is called yet.

### Added

- **Observation window** (`src/slices/observer`). Engine events become a bounded,
  ordered log: programmer prompts (`input`, extension-injected messages
  excluded), tool calls paired start→end by `toolCallId`, and completed turns.
  An end event without a start is recorded rather than dropped, and parallel tool
  calls keep their own arguments.
- **Signal fold** (`src/shared/signals`) — arithmetic over the window, no model:
  tool calls and failures, failing tools, churn, successful verification runs and
  turns since the last one, restatements by token overlap, unscoped long prompts,
  correction-marker counts, idle gaps, and `unverifiedWindow`.
- **Evidence lines** — the only text that will cross into the appraiser's prompt.
  Counts, never conclusions, so every downstream claim is traceable to a number.
- **Heuristic lexicon** (`src/shared/lexicon`) — every pattern table in one
  screen, because a plugin that reads a session psychologically must make its own
  notion of "progress" auditable.
- **Config cascade** (`src/shared/config`) with `model: ""` as the default, which
  means observation at zero model spend. Budget and cadence keys are in place for
  the appraiser.
- **State kernel, statusline chip, i18n (en/cs), version stamp**, and an `index.ts`
  composition root with the subagent recursion guard and an idempotent
  `session_shutdown` drain.
- **37 tests** over three files, including a hand-counted session fixture and a
  test asserting the evidence text never interprets.

### Fixed

- An empty window no longer reports "no verification succeeded". That was a
  claim about work that never ran; a `turns` count now gates the line, and the
  test that caught it is kept.