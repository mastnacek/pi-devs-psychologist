# CHANGELOG

## 0.6.1 (unreleased)

T8. The appraiser gets an objective map of the repo the session is working in — file sizes, the
longest files, the test-to-source ratio, the slice layout — as citable evidence, so "this is a large
change" is a number from arithmetic rather than a guess. Pure `node:fs`, no model, no watcher.

### Added

- **`mapRepo` config key (default `true`).** Adds the repo-map lines to the SESSION evidence and a
  "Repo map" section to `/psych`. `false` withholds them and the report says the map is unavailable.
- **`src/shared/repo-map.ts` (pure core, T8).** `buildRepoMap(files, options) → { evidence, facts }`
  over an already-counted `{ path, lineCount }[]`: `fileCount`, `sourceFileCount`, `testFileCount`,
  `testToSourceRatio` (2 decimals), `longestFile` (ties → first path), `filesOver300Lines`,
  `topLevelDirs`, `sliceDirs`, `medianFileLines`, `skippedLarge`.
- **`src/slices/mapper/` (T8).** `collect.ts` walks `cwd` with `lstat` only — symlinks are skipped,
  never followed — skipping `node_modules`/`dist`/`build`/`coverage`/dot-dirs (except `.github`),
  capping at 4000 files and 1 MiB per read. Only the line count leaves the walk; no file content ever
  reaches a prompt. `index.ts` adds the git-work-tree gate (`git rev-parse --show-toplevel`, cwd
  fallback when git is absent) and a once-per-session cache in `state.repoMap`.
- **Repo map in `/psych` (T8).** A "Repo map" section (en + cs), width-safe, with a `map age: N turn(s)`
  line once the cached map is older than 20 turns.

## 0.6.0

- **T33 — research grounding.** No code: the existing NotebookLM notebook behind `docs/research-notes.md` is allowed via `agent.nlmNotebooks`; README section documents the setup. Verified live: `/psych ask` queried it and returned a `nlm:<id>`-sourced suggestion (3 tools, 81 s).
- **Live-verified scout:** `/psych scout` for unverified commits found `pi-gauntlet` (fit: solves) in 30 s.

T31. The scout role turns recurring friction into a question asked before anything is built: does the
pi ecosystem already solve this, or is a small plugin worth building? It runs on the agent runtime,
behind its own consent gate, and never writes to the working agent.

### Added

- **`roles.scout.enabled` and `roles.scout.workshopDir` (T31).** New `src/shared/role-config.ts`. The
  scout is OFF by default (a run spends model money). `workshopDir` defaults to this workshop monorepo,
  which the child is told to read (README files only, never edit); `""` omits the sentence from the
  brief. Every key normalised on its own, like the rest of the cascade.
- **`SCOUT_SCHEMA` (T31).** Up to 3 `candidates` `{ name, installSpec, url, why (≤160), fit }`, an
  optional `build` `{ title, oneLine }`, and up to 4 `cited`. `psych_submit` validates it for role
  `scout` (`schemaForRole`). `installSpec` must match the T25 forms (`npm:<name>` or
  `git:github.com/<owner>/<repo>`), `url` must be `https://`, `fit` must be one of
  `solves|partial|inspiration` — a candidate failing any rule is DROPPED and counted (`scout-enforce.ts`).
- **`/psych scout [topic]` (T31).** New slice `src/slices/scout/`, a card (`ScoutView`,
  `layoutScoutCard`/`measureScoutCard`) and a notification fallback. The topic defaults to the top
  recurring fingerprint; with none it answers with the usage line. The `build` block becomes a
  paste-ready SPAI idea line (`? <title> — <oneLine> @<project> :scout:`), never recorded automatically.
  When nothing survives and there is no build, the operator-triggered run says "nothing found"; the
  automatic run stays silent.
- **Automatic scout trigger (T31).** On `turn_end`, a `recurring_failure` at fingerprint count ≥ 3,
  with `roles.scout.enabled` and the agent runtime, replaces that turn's appraisal — the two never run
  together. At most once per fingerprint per session (tracked in state), consuming one budget unit,
  honouring the session cost cap, sharing single flight and the researching chip, and cancelled by
  `/psych stop`.
- **Scout role paragraph in the child brief (T31).** `pi list` first, then `https://pi.dev/packages?name=<terms>`
  (2–3 terms), npm and GitHub; prefer an existing package; `fit: "solves"` only for a clear fit. The
  `TOPIC — …` block is placed before the final line, leaving the evidence prefix byte-identical (D2).
- **i18n** keys for the scout card, the command description and the scout notices, in `en` and `cs`,
  plus a `scoutFits` label group.


## 0.5.1

T28, T29 and T30. The two wider consent levels start to carry data: `digest` sends a bounded,
scrubbed transcript excerpt, and `fork` hands the child the whole session after a one-time
confirmation. Both are agent-runtime only and both leave the API path byte-identical. T30 adds
`/psych ask`, the operator consulting the observer directly.

### Added

- **`digest` context level (T28).** New pure `src/shared/digest.ts`: `buildDigest(entries)` folds the
  branch into the last 12 operator prompts (≤500 chars) and the assistant's *text* blocks (≤300
  chars; never thinking) plus one line per tool call (`tool(<path|command>) ok|fail`, never the tool
  output), chronological, capped at 6000 chars with the OLDEST items dropped first. `scrubSecrets`
  runs last and redacts `sk-…`, `ghp_`/`gho_`/`ghu_`/`ghs_`…, `github_pat_…`, `AKIA…`, `xox[bp]-…`,
  `Bearer …`, PEM `-----BEGIN … KEY-----` blocks, and `KEY=value` / `KEY: value` where the key names
  a credential. The appraiser builds the digest from `getBranch()` only when `runtime: "agent"` and
  `agent.context` is `digest`; the API request never carries one.
- **`fork` context level (T29).** New `src/shared/agent-context.ts` resolves the run-time context.
  `fork` reads `ctx.sessionManager.getSessionFile()` **at run time** (not the value seen at
  `session_start`) and, on the first fork of a session in a TUI, asks once with a confirm stating the
  estimated size (the latest assistant turn's `usage.input + cacheRead`) and its price at the child
  model's input rate (tokens only when the rate is unknown). A decline, a missing session file
  (ephemeral parent) or a non-TUI run (RPC) degrades `fork → digest` and says so once per session
  (en + cs). The `<runTmp>/session` directory is removed together with `runTmp`.
- **i18n** keys for the fork confirm and its two fallback notices, in `en` and `cs`.
- **`/psych ask <question>` (T30).** The operator consults the observer directly. New slice
  `src/slices/ask/`: always the agent runtime, falling back to a tool-less API call that says so on
  the card (`api runtime — no research`). `ASK_SCHEMA` becomes the real `ask` contract — a ≤800-char
  `answer`, up to 4 exactly-copied citations, and optional `suggestions` (the T25 source rule) — and
  `psych_submit` validates it for role `ask`. The child's brief gains an `ask` role paragraph and a
  `QUESTION — …` block placed before the final line, leaving the evidence prefix byte-identical. An
  answer whose citations do not match is KEPT and marked unsupported, never hidden; the API runtime
  uses no source policy, so only a URL or install spec can survive a suggestion. `/psych ask`
  consumes one budget unit, honours the session cost cap and shares single-flight with appraisals; it
  is never written into the working agent's context. The `ask` completion is non-terminal (`ask `)
  with no further items.


## 0.5.0

T20 and T21. The `agent` runtime is introduced as a switch: config, a one-run CLI flag, `/psych`
commands and an ADR. Nothing spawns yet — `runtime: "agent"` changes only the config, the
report and the statusline chip; the appraiser still uses the API call.

### Added

- **ADR 0002 (`docs/adr/0002-agent-runtime.md`, T20).** Why a child pi over a bare completion;
  the three context levels as three consent levels and what leaves the machine at each;
  the read-only guarantee and that it is enforced by our own `tool_call` guard because no peer
  plugin (notably `pi-secret-guard`) can be assumed (spike Q5); the private child marker (D5);
  and the kill criterion. PRD §4.1 links to it; README obtains a consent-levels hard rule.
- **Config `runtime: "api" | "agent"` (default `"api"`) and a nested `agent` object (T21):**
  `model`, `thinking`, `context` (`evidence|digest|fork`), `timeoutMs`, `maxToolCalls`,
  `maxCostUsd`, `maxCostUsdPerSession`, `allowWeb`, `allowMcp`, `allowNlm`, `nlmNotebooks`,
  `extraArgs`, `keepTranscript`. Every key is normalised independently (junk → default; arrays
  must be arrays of strings; numbers finite and ≥ 0), and the `agent` object merges **per key**
  across the global and project layers, like the rest of the cascade.
- **Effective agent model.** `agent.model` when non-empty, else the shared `model`. With
  `runtime: "agent"` and no resolvable model the plugin is observation-only, and the chip
  says so (`psych: agent, no model`, en + cs).
- **CLI flag `--psych-runtime agent|api`.** Overrides `runtime` for this process only and is
  never written to disk; an invalid value is ignored with a notification. Read via `pi.getFlag`
  at `session_start`.
- **`/psych runtime <api|agent>`, `/psych context <evidence|digest|fork>`,
  `/psych agent-model <provider/id>`**, all accepting the trailing `--global`. The `agent-model`
  picker reuses the registry-driven two-level model picker. Selecting `digest`/`fork` in a TUI
  opens a confirm stating what will leave the machine; outside a TUI it is refused, because a
  one-run channel must never carry a persisted (consent) decision.
- **`/psych` report** now shows the runtime, the effective agent model and the context level.
- **Child mode (T22).** With `PI_DEVS_PSYCH_CHILD=1` this package registers **only** a read-only
  `tool_call` guard and one tool, `psych_submit`, and returns before the recursion guard — no observer,
  no appraiser, no `/psych`, no chip (the child must not observe itself). New slice `src/slices/child/`
  (`guard.ts`, `submit.ts`).
- **`psych_submit`** takes the role's TypeBox schema (`psychologist` → the appraisal contract, the
  other roles → `ASK_SCHEMA` for now, TODO(T30/T31)), validated with `Value.Check`; an invalid answer
  `throw`s with the failing field path (first three, so a child model can retry), a third still-invalid
  submission is told to stop guessing, a second successful submit is refused, and success returns
  `"Submitted. Stop now."` with `terminate: true`, so the run ends instead of spending another turn
  (the engine's tool-termination contract, `AgentToolResult.terminate`).
- **The read-only guard (D4) blocks by name and by pattern, not by prompt.** Tools: `edit`, `write`,
  `apply_patch`, `str_replace`, `ast_grep_replace`, `record_spai_item`, `update_spai_status`,
  `workflow`, `workflow_control`, `batch_submit_goal`, `subagent`, `subagents_enable`,
  `plugin_dev_scaffold`, `add_project_root`, `add_project_manually`, and any name matching
  `/(write|edit|delete|replace|install|remove)/i`; bash: the new `CHILD_FORBIDDEN_BASH` table plus
  output redirection into a path (`2>&1`, `>/dev/null` and `> nul` stay allowed); `web_*` /
  `mcp*` / `nlm` gated by `allowWeb` / `allowMcp` / `allowNlm`; and everything except `psych_submit`
  once the tool budget is spent. `PI_DEVS_PSYCH_LIMITS` is parsed **fail-closed**
  (`src/shared/child-limits.ts`): a missing, malformed or non-boolean value means the capability is
  off and the budget is 10.
- **The agent brief (T23).** New pure `src/shared/agent-brief.ts`,
  `buildAgentBrief(input) → { systemAppend, userMessage }`. The system append carries the role
  prompt (the psychologist's `SYSTEM_PROMPT` with **only** its JSON output paragraph replaced by
  `SUBMIT_OUTPUT_INSTRUCTION`, so the child is told to call `psych_submit`; the anchor is an exact
  substring and the module **throws at load** if a prompt edit removes it), “where you are”, the pi
  docs map (verified against the installed engine), the pi-packages guidance, the tool bullets the
  limits allow (web / mcp / skills / NotebookLM / repo), the budget and the research rule. The user
  message keeps `buildUserText`’s evidence **byte-identical** (D2), swaps the final line for
  “Appraise the session now. Submit with psych_submit.” and accepts an optional `DIGEST — …` block.
  Companion impure helper `src/shared/pi-paths.ts` (`resolvePiDocsDir({ argv1, packageDir, exists })`)
  resolves the engine docs dir from `dist/bundle/cli.js` or `PI_PACKAGE_DIR`, returning it only when
  `docs/docs.json` exists.
- **The runner (T24).** New pure `src/shared/agent-argv.ts` (`buildChildLaunch` → `{ command, args,
  env, fallback }`) and `src/shared/agent-stream.ts` (the JSONL reducer: `psych_submit` args + a
  matching, non-error `tool_execution_end`; summed usage; a tool census; the capped last assistant
  text), wrapped by `src/shared/agent-runner.ts` (`runAgent(request, options, io)`, io injectable).
  The child is spawned as `process.execPath` + the engine's own `cli.js`, `shell: false`,
  `stdio: ["ignore","pipe","pipe"]` (stdin closed — the message travels as its own `@<file>` token),
  `--append-system-prompt <briefFile>`, `--no-session` or `--fork <file> --session-dir <tmp>/session`
  (a fork without a session file falls back to `--no-session` and reports it), trust mirrored as
  `--approve`/`--no-approve`, and `PI_DEVS_PSYCH_CHILD/RUN/ROLE/LIMITS` set while `PI_SUBAGENT` and
  `PI_CHILD_SESSION` are removed (D5). A submitted run returns `{ ok: true, text: JSON.stringify(args) }`
  so `parseAppraisal` runs unchanged; otherwise a typed stage (`no_submission | exit | spawn |
  timeout | budget | aborted`) with the last assistant text or an 8 KB-capped stderr tail. A
  wall-clock timeout, a per-run cost cap and the session abort signal each kill the whole tree
  (idempotent: `taskkill /PID <pid> /T /F` on Windows, `process.kill(-pid)` on POSIX) and the run
  directory is removed on every path unless `agent.keepTranscript`. The composition root swaps
  `deps.callModel` for the runner when the effective `runtime` is `agent`, tracks session cost and
  refuses a run once `agent.maxCostUsdPerSession` is reached, and `session_shutdown` kills a running
  child. The appraiser's gate is unchanged; only the call is.
- **Researched suggestions (T25).** The appraisal contract gains an optional `suggestions` array
  (≤ 3), each `{ kind: package|skill|doc|research|workflow, text ≤ 200, source, cited? ≤ 2 }`; the
  schema accepts it with and without, and `psych_submit` carries it for the child. Enforcement
  (`appraisal-enforce.ts`, new `SourcePolicy`) keeps a suggestion only when its `source` resolves to
  something real — an `https://` URL, a path inside the resolved pi docs dir (both absolute and
  relative, `..` refused), `nlm:<id>` for a consented `agent.nlmNotebooks` id, or an install spec
  `npm:<name>` / `git:github.com/<owner>/<repo>`; anything else is dropped and counted in `unmatched`
  as `suggestion: <source>`, unmatched `cited` lines are dropped, and text is trimmed and truncated.
  The appraiser passes the policy from the composition root (`docsDir` + `agent.nlmNotebooks`). The
  card gains a width-safe "Researched suggestions" section (one clamped line per suggestion plus its
  dim source, omitted when empty) and the notification fallback lists at most one. Suggestions are
  operator-only: they are **never** sent to the working agent, even with `steerAgent: true`. The API
  runtime's `SYSTEM_PROMPT` is untouched (D2); only `SUBMIT_OUTPUT_INSTRUCTION` names the field.
- **Async delivery and the researching UX (T26).** `turn_end` **starts** the appraisal and returns
  immediately — the promise is kept in state, so a session is never blocked on a model that takes
  tens of seconds (both runtimes). `/psych now` still waits, and waits on the in-flight promise when
  one exists. A finished result that arrives while the agent is streaming is **held** and presented
  on the next `agent_end`; a newer held result replaces an older one. The appraiser records the turn
  the run started on, and a delivery whose window has moved on by ≥ 3 turns says `based on the
  session N turns ago` in the card header (en + cs; `measureCard` stays exact). The chip switches to
  `psych: researching 42s · 7 tools` (agent) / `psych: researching 42s` (api), repainted at most once
  per second on an injectable clock and cleared in the appraisal's `finally` and on `session_shutdown`;
  the runner reports `onProgress({ toolCalls, elapsedMs })` from the stream reducer. New terminal
  `/psych stop` kills the run (child kill handle; the API call and the agent run both abort through an
  `AbortController` that forwards the session signal), records failure stage `aborted` and clears the
  held result; it notifies when nothing is running.
- **Accounting in `/psych` (T27).** The report gains a width-safe "Last run" block — runtime, model,
  context level, duration, top-5 tool calls by name, tokens in/out, cost and outcome stage — and a
  session line `runs this session: N · agent cost $x / $cap` (a zero cap renders `unlimited`). Last-run
  metadata is stored in state for both runtimes and for failures as well as successes. A new
  `AppraiseOutcome` reason `cost` refuses the next agent run **before spawning** when
  `agent.maxCostUsdPerSession` is reached; the report states the reached cap.

## 0.4.0

T14, T15 and T18. The appraiser stops running on a clock and starts running on evidence, and a
commit no run ever verified is named for zero tokens. T16 and T17 add a ledger that measures
whether the interventions help, and stop repeating the ones that do not.

### Added

- **Signal-triggered appraisal (T14).** New pure `src/shared/triggers.ts` with
  `evaluateTriggers(current, baseline, thresholds)` and `snapshotTriggers`. A trigger is a delta
  against a baseline snapshot taken at the last attempt, so the same old failure never fires twice.
  Reasons: `failure_streak`, `recurring_failure`, `restatement`, `operator_abort`, `stale_progress`,
  `compaction`, `thinking_raised`, `delivered`, `commit_unverified`.
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
- **Delivery-boundary check (T15).** On a successful `bash` command matching `COMMIT_COMMANDS`
  (`git commit`, `git push`, `gh pr create`, `npm publish` — never `pi update`), if there are
  successful mutations since the last verified run, the plugin delivers ONE notification (from
  `i18n.ts`, `en` + `cs`) and adds one LIVE evidence line
  `commit after N file change(s) with no verified run since`, and raises trigger
  `commit_unverified`. `N` comes from the pure `mutationsSinceVerified` helper in `signals.ts`,
  shared with the observer so the line and the notification can never disagree. Nothing on the
  success path, a failed command, or `commitCheck: false`. **Observes only** — never blocks or
  delays the command (D8).
- **Config `commitCheck: boolean` (default `true`).** Normalised opt-out; the same switch silences
  the notification, the evidence line and the trigger.
- **Intervention outcome ledger (T16).** New pure `src/shared/outcome.ts`. Every delivered
  intervention opens a record `{ id, kind, deliveredAtTurn, channel, before }` with a `before`
  snapshot of `{ failureRate, turnsSinceVerifiedProgress, restatements, aborts }`. After
  `outcomeWindowTurns` turns an `after` snapshot yields a verdict per metric
  (`improved | unchanged | worse`) by plain comparison — documented thresholds, no weighting and
  **no single aggregate score**. Reactions are recorded when observable: `closedCardMs` (measured
  around `presentAppraisal`), `quickWinCalled` (a `quick_win` run inside a `name_next_win` window)
  and `followed` (the next operator prompt shares ≥ 40 % of its tokens with the advice, via the
  restatement overlap helper). Records are persisted as TUI-only `custom` entries and rebuilt from
  `getEntries()` on session start.
- **`/psych effect`.** New terminal-leaf subcommand: a per-kind table of delivered, improved,
  unchanged, worse and followed. Session-scoped, width-safe (`truncateToWidth`), `en` + `cs`.
- **Anti-nag cooldown (T17).** Per-kind `cooldownTurns`. A cooling/muted kind adds one LIVE line
  `do not repeat: <kind> (named N times, no change)` to *both* the prompt and `allowedEvidence`.
  A kind delivered twice whose windows fail to improve is muted, and a repeat the model still picks
  is dropped — verdicts kept, `downgraded: "cooldown"` recorded for `/psych`. `stop` is exempt from
  cooldown but not from muting.
- **Config `outcomeWindowTurns` (default `5`) and `cooldownTurns` (default `6`).** Both normalised
  with a floor of 1; junk → default.

### Changed

- **Minimal T7.** The last appraisal is persisted as a `custom` entry (`psych-appraisal`) and
  restored on `session_start`, so `/psych` survives `/reload` and compaction. Restoring contributes
  zero observations — the judgement never re-enters the window.

- `maybeAppraise` keeps the floor and the budget, and adds a `no_trigger` skip between them.
  `force` (`/psych now`) bypasses the trigger and the floor, never the budget.
- State gains `triggerBaseline`, `appraisalsSkipped` and `lastTriggerReasons`; all reset on session
  start alongside the window.
- `SessionSignals` gains `failureStreak` and `deliveredRuns`, the two counters the trigger rule
  needed that the fold did not expose — plus `unverifiedCommits` / `unverifiedCommitChanges` (T15).
- `signals.ts` was split by concept: the evidence renderer moved to `signals-evidence.ts`, the
  same way `history.ts` / `history-evidence.ts` already are.

### Verification

`trigger-appraisal.test.js` asserts 30 healthy turns cost zero calls, a 3-failure streak spends
once and not again, and the trigger line is citable. `triggers.test.js` asserts each reason in
isolation and against a baseline that already saw it. `commit-check.test.js` asserts the delivery
boundary: two edits then a commit fires one notification and one line with N=2; a verified set, a
failed command, `commitCheck: false` and a headless context all stay silent. `outcome.test.js`
asserts the verdict arithmetic and the precise muting rule; `outcome-cooldown.test.js` drives a
fake model that picks `thin_slice` three times with no improvement and asserts delivered twice,
third dropped, the warning present from the second call, and `stop` exemption; `effect.test.js`
asserts the table is width-safe to a mocked width; `persistence.test.js` asserts the appraisal and
ledger survive a reload from `getEntries()` as `custom` (never `message`) entries.

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