# CHANGELOG

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