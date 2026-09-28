# CHANGELOG

## 0.4.0 (unreleased)

T14 and T18. The appraiser stops running on a clock and starts running on evidence.

### Added

- **Signal-triggered appraisal (T14).** New pure `src/shared/triggers.ts` with
  `evaluateTriggers(current, baseline, thresholds)` and `snapshotTriggers`. A trigger is a delta
  against a baseline snapshot taken at the last attempt, so the same old failure never fires twice.
  Reasons: `failure_streak`, `recurring_failure`, `restatement`, `operator_abort`, `stale_progress`,
  `compaction`, `thinking_raised`, `delivered`. (`commit_unverified` is left to T15; the reason list
  is the single extension point.)
- **Config `trigger: "signals" | "cadence"` (default `"signals"`) and `triggerThresholds`.**
  `signals` appraises on new evidence with `cadenceTurns` as a floor; `cadence` is exactly the old
  clock. New default `cadenceTurns` is **3** (it is now a floor). Thresholds normalise per key;
  junk → default.
- **The reason is citable evidence.** When a trigger fires, one LIVE line
  `appraisal triggered by: <reasons>` is added to *both* the prompt and `allowedEvidence`, so the
  model may cite why it was asked.
- **`recurring failure: <tool> · <signature> ×N` (T18).** Every `FailureFingerprint` with count ≥ 2
  becomes its own evidence line, highest count first, capped at three.
- **`/psych` shows the trigger rule**: the mode, the reasons that last fired, and
  `appraisals skipped: N (no new evidence)` — the measured saving.

### Changed

- `maybeAppraise` keeps the floor and the budget, and adds a `no_trigger` skip between them.
  `force` (`/psych now`) bypasses the trigger and the floor, never the budget.
- State gains `triggerBaseline`, `appraisalsSkipped` and `lastTriggerReasons`; all reset on session
  start alongside the window.
- `SessionSignals` gains `failureStreak` and `deliveredRuns`, the two counters the trigger rule
  needed that the fold did not expose.

### Verification

`trigger-appraisal.test.js` asserts 30 healthy turns cost zero calls, a 3-failure streak spends
once and not again, and the trigger line is citable. `triggers.test.js` asserts each reason in
isolation and against a baseline that already saw it.

## 0.3.1 — README truth pass

### Fixed

- **The README contradicted the code.** The Status section claimed `0.2.0` and a stale test count;
  the key table marked `model` "Chip only until T4" and `restatementThreshold` / `unscopedWordFloor`
  / `idleGapMs` "Pending T3/T4" even though the appraiser has shipped and every one of them is read
  at runtime (the three signal keys via `signalOptions` → `extractSignals`); a sentence claimed the
  `/psych` command "is not built yet" when `src/slices/commands` has shipped; and `envFacts` was
  missing from both the JSON example and the key table.
- Every row is now **Live**, matching a grep of each `DEFAULT_CONFIG` key for its consumer, and the
  stale "Pending keys" paragraph is gone.

### Added

- **`test/readme.test.js`** asserts a markdown table row for each `DEFAULT_CONFIG` key, so the README
  cannot silently drop a key again.

## 0.3.0 — the model picker asks the registry

### Added

- **`/psych model` completes from the engine's registered models and providers** instead of
  accepting only free text. Two levels: providers, then a provider's models. Multi-account support
  falls out of this for free — `pi-openrouter-accounts` registers each OpenRouter account as its
  own provider id, so listing providers *is* listing accounts.
- Matching is **substring**, because the account is `soukr` while its provider id is
  `openrouter-soukr`, and the interesting part of a model id is usually in the middle.
- The list is **capped at 50** with a localised overflow row saying how many were hidden, and
  selecting that row re-inserts the current text so a truncation is never silent.
- The **model in effect is marked** with a tick in the label and a text marker in the description,
  at its own row and at its provider's row. The marker never enters the inserted value, and never
  uses ANSI.
- The catalog is cached from the registry at session start and refreshed whenever `/psych` runs,
  so an account added mid-session is picked up on the next Tab press. With no catalog the picker
  defers to the engine rather than failing.

### Fixed

- **A fully-typed `model` now offers its providers without waiting for a space.** Tab-confirming a
  non-terminal token closes the picker, and a space switches the engine to file completion, so the
  provider list was unreachable by Tab altogether. `lang` already did this; `model` did not. This is
  the trap `references/command-completions.md` exists to document.
- Current-value markers moved into `item.label`, where the reference requires them, in addition to
  the description.

### Notes

- The multilingual lint invariant covers `notify`/`select`/`describe` text, **not** completion
  items, so two hardcoded English strings in the overflow row were invisible to it. Reading the
  completion reference is what surfaced them; they now come from the locale table.

## 0.2.0 — the card, the command, and the delivery policy

T5 and T6. When an appraisal has something to say, it now arrives as a card; `/psych` answers
with the record behind it.

### Added

- **The appraisal card** (`src/slices/overlay`). Verdicts with the evidence lines they cited,
  and the intervention underneath. Height is *measured* from the same layout the view draws, so
  a short card gets a small window and a long one scrolls its verdicts — **the intervention is
  never clipped**, because that is the one thing the card exists to deliver. Every line is
  truncated to the supplied width and padding is computed on visible width, so wide characters
  and ANSI escapes cannot corrupt the frame; both are asserted, with a painting theme as well as
  a plain one.
- **Read-only on purpose.** `esc`, `enter` and `ctrl+c` all close it. The card reports rather
  than asking the operator to choose, because a choice is an action surface and that belongs to
  `pi-quick-win` (ADR 0001).
- **The delivery policy** (`src/slices/interventions`). Card where a card can render →
  notification where it cannot (RPC, `json`/`print`) → nothing. A presentation failure degrades
  down that ladder rather than losing the intervention, because an overlay that cannot draw and
  a plugin that says nothing look identical from outside.
- **`steerAgent` is live and off by default.** When on, one line goes into the working agent's
  context, prefixed `[pi-devs-psychologist]` and ending "consider it; do not obey it blindly" so
  the agent does not read an observer's suggestion as the operator speaking. Idle sends now;
  streaming queues as `deliverAs: "followUp"`, so the observer can never cut the worker off
  mid-stream.
- **`/psych`** (`src/slices/commands`) with `status` (default), `now`, `on`/`off`,
  `model <provider/id>`, `budget <n>`, `lang <en|cs>`, and a trailing `--global` on any
  setting command. Completions follow the Trailing Space Contract, replace the whole argument
  text (so flags carry the value they follow), offer `lang`'s parameters as soon as the token is
  typed rather than only after the space, and mark the value in effect.
- **The text report** (`src/slices/report`) — plain, theme-free, and the only place three things
  appear: the evidence actually used, the claims refused, and the money spent that the session
  meter does not know about.
- `--global` is a **trailing flag** on setting commands, per the workshop convention, not a
  subcommand.

### Changed

- `maybeAppraise` takes `pi` (steering needs the API) and an options object. `force` skips the
  cadence because the operator asked explicitly; it does **not** bypass the budget, because a
  ceiling that yields on request is not a ceiling.
- The appraiser no longer touches a surface at all: it hands the enforced appraisal to an
  injected policy. A delivery failure leaves the appraisal stored and the turn intact.
- `DeliveryOutcome` lives in `src/shared/delivery.ts` — two slices need the vocabulary and
  slices may not import each other.

### Verification

169 tests. The card's width rule is asserted at four widths with a plain and a painting theme;
`measureCard` is asserted equal to what the view actually draws; the intervention is asserted to
survive a 10-row window; and the completion contract is asserted per level, including the lazy
path and the flag's full-prefix value.

## 0.1.0 — the appraiser works

The plugin now does what it was built for: it reads the objective evidence, asks a second
model what it means for the person, and refuses to pass on anything that model cannot
cite. This is T2, T3 and T4.

### Added

- **The model call** (`src/shared/model-call.ts`) — the one place the plugin talks to a
  model. Resolves `provider/modelId` through the registry, resolves auth per request, and
  returns a typed result naming the stage that failed (`config` / `resolve` / `auth` /
  `request` / `response`) instead of throwing into the session. The reference splits on the
  FIRST slash only, because OpenRouter model ids contain slashes.
- **The prompt** (`src/shared/prompt.ts`) — model-facing English, rule-shaped rather than
  a psychology lecture. Evidence lines are presented verbatim and unnumbered so a copied
  citation is byte-identical and matches on the first attempt.
- **The contract** (`src/shared/appraisal.ts`) — the appraisal schema built from
  `StringEnum`, with `unassessed` / `unproven` as first-class abstentions. The model
  **classifies and cites; it never enumerates facts**, which is why there is no free-text
  "what got done" field for an invented achievement to appear in.
- **Citation enforcement** (`src/shared/appraisal-enforce.ts`) — every verdict must cite a
  line the plugin actually supplied. An uncited verdict is downgraded to its neutral value;
  an uncited intervention is removed; two interventions are refused as a batch rather than
  truncated, because taking the first would reward ignoring the contract. A fully fabricated
  response parses to silence.
- **The appraiser** (`src/slices/appraiser`) — cadence, budget, single-flight, and a typed
  outcome naming why it did or did not run (`disabled`, `headless`, `no_model`, `in_flight`,
  `cadence`, `budget`). Budget and cadence are **attempts**-based, because a failed call may
  still be billed and a failure retried every turn is a spend loop. Headless sessions spend
  nothing at all.
- The chip reports a configuration failure (`psych: check model`) persistently, because
  only the operator can fix it — while a transient provider error stays quiet.

### Fixed

- **A `load` verdict could never be anything but `unassessed`.** The field is `level`, the
  enforcement helper read `state`, so the cognitive-load reading silently fell back to
  neutral forever. The schema test could not catch it (the schema has `level`); the
  enforcement test did. The reader now takes the field name, and `load` is covered
  specifically.

### Measured, and worth knowing

- **The engine cannot be told about these calls.** Extensions receive a
  `ReadonlySessionManager` — a `Pick<…>` of read-only methods with no `appendUsage` — so the
  session's own token and cost meter does **not** include appraisals. The skill's "include
  usage in the tool result" rule has no equivalent for a background call: a tool can report
  usage because the engine is waiting on its result. The plugin reports its own spend
  itself (`state.lastAppraisalUsage`) rather than implying the engine counted it.

### Verification

119 tests. The headline one is the cost model: forty turns, cadence 8, budget 3 — exactly
three calls, and the fourth refused. Also pinned: a failed attempt consumes budget and
restarts the cadence, a slow appraisal is not asked twice, a fabricated response reaches
nobody, and the schema contains no `anyOf`/`const` so Google's API accepts it.

## 0.0.6 — the config file now exists, and history is split by concept

### Fixed

- **An installed plugin whose config existed nowhere on disk.** `saveConfig` was only
  ever called from tests, so no config file was ever created: the settings were real,
  documented and readable, but there was nothing to edit and no answer to "where do I
  configure this?". The first session now seeds `~/.pi/agent/pi-devs-psychologist.json`
  with the defaults and says so once in a notification — silent seeding would leave the
  file exactly as undiscoverable as no file at all.
  - Never overwrites. An existing file is left alone even when it is unparsable,
    because replacing a hand-written config with defaults would destroy a real edit.
  - An unwritable path is not an error: the session falls back to defaults and
    continues.

### Changed

- **`history.ts` split by concept** into `history.ts` (read entries → numbers, 285
  lines) and `history-evidence.ts` (numbers → the lines a model may read, 77). It was
  350 lines, past the skill's 300-line soft target, and the split is conceptual rather
  than numeric: a new entry type touches the fold, a wording change touches the
  evidence.
- The extension factory takes an options object (`{ globalFile }`). It is the seam
  that lets the test suite point at a temp config home, so no test can seed the
  operator's real `~/.pi/agent` — the same reason `state.globalFile` exists.

### Added

- Five more tests (74 total): the file is created with the defaults and announced
  once; an existing file — including a corrupt one — is never overwritten; seeding is
  announced on exactly one session out of three; an unwritable path degrades instead
  of throwing; and the seeded file is the file the plugin subsequently reads, so it
  cannot be a decoy.

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