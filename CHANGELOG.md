# CHANGELOG

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