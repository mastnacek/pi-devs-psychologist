# pi-devs-psychologist

**A second model watches the session as an engineering psychologist.**

The working agent does the work. This plugin runs a *different* model alongside
it that reads what actually happened — prompts, tool outcomes, churn, verified
progress — appraises the programmer's **motivation, cognitive load and progress
against the published research on developer psychology**, and names **at most one
intervention**. Every claim it makes is traceable to a number it was given.

```bash
# The repository is private, so cloning requires stored GitHub credentials
# (`gh auth setup-git` if git cannot authenticate).
pi install git:github.com/mastnacek/pi-devs-psychologist

# try without installing
pi -e git:github.com/mastnacek/pi-devs-psychologist
```

---

## The one-line difference from a coach

A coach has opinions. This has **evidence and a budget**.

Every observation enters the appraiser as a fixed list of factual lines, and the
model is required to cite the lines it used. It cannot invent progress, cannot
score the programmer, and cannot decide for them:

```
Observed signals                             ← arithmetic, no model
  window: 3 prompt(s), 8 tool call(s), 21 min
  tool failures: 3/8 (38%), repeated: bash
  verified progress: none — no test, lint, typecheck or build succeeded in this window
  prompts restating an earlier prompt: 1
  prompts containing a correction marker: 1
  files mutated more than once: src/shared/signals.ts

Appraisal                                    ← second model, cited + budgeted
  ...
```

---

## What it observes

Nothing is watched by a file watcher and nothing is read from disk to produce
these numbers. They come from the engine's own events, folded by arithmetic:

| Signal | Event source | Why it is in the model's prompt |
|---|---|---|
| Prompt text | `input`, excluding extension-injected messages | Only the programmer's own words count as theirs |
| Tool outcome | `tool_execution_start` / `_end` paired by `toolCallId` | A failure is a failure, not "the agent is struggling" |
| Verified progress | successful runs of a command that **can fail on the work** | The Progress Principle needs real progress, not activity |
| Churn | mutation-tool `path` used more than once | Repeated work on one file is a thin-slice / block signal |
| Restatements | token overlap between prompts | "I already asked this" is the strongest block evidence there is |
| Idle gaps | time between prompts | Interruptions break flow and are worth naming |
| Turns since verified progress | completed turns after the last proven run | The Amabile "worked but did not advance" day, made countable |

`src/shared/lexicon.ts` holds **every** heuristic as a readable list, so you can
disagree with the plugin's notion of "progress" by editing one screen of
patterns.

### From the session's own record

The live window cannot see a session's *history*. The engine's own session entries can,
so a second fold reads `sessionManager.getBranch()` (`src/shared/history.ts`):

| Signal | Entry | Why it is the strongest evidence available |
|---|---|---|
| Operator cancelled a turn | `message.stopReason === "aborted"` | The human pressed stop. A literal engine field, not a sentiment score |
| Operator bookmarks | `label` (`/label`) | The only place the human states where the value was |
| Operator raised thinking level | `thinking_level_change` | Their own difficulty calibration — no guessing needed |
| Session declared purpose | `session_info.name` (`/name`) | Lets the appraisal compare intent against what actually happened |
| Model switched | `model_change` | The operator rejected the model they were on |
| Approaches abandoned | `branch_summary` (`/tree`) | Paths walked away from, counted without judging them |
| Context pressure | `compaction.tokensBefore`, `engine` vs `hook` | How much context had to be thrown away, and by whom |
| Context erased vs rewritten | `context_edit.replacement` | What was removed from the model's view |
| Wait for the agent | user → assistant message timestamps | A broken flow, measured in seconds |
| Prompt-cache read share | assistant / toolResult `usage` | A real, measurable friction in the loop |

The full study — including what was **refused** (message bodies, system and skill
sections, cost totals, other plugins' state, cross-session history) and why — is in
`docs/session-data.md`.

---

## Hard rules (these are the product)

1. **One intervention, maximum.** Never a list of advice.
2. **Every claim cites an evidence line** the plugin supplied. No citation, no claim.
3. **No scores, streaks, badges or productivity tracking.** Expected external
   reward reduces intrinsic motivation — Deci, Koestner & Ryan (1999), the
   overjustification effect. This plugin names real delivered work or says nothing.
4. **Empty is a valid answer.** A window with nothing to report produces nothing.
5. **Observer, not authority.** `steerAgent` is off by default: it cannot write
   into the working agent's context unless you ask it to.
6. **Bounded cost.** `model: ""` (the default) is *observation with zero model
   spend*. With a model set, `cadenceTurns` and `maxAppraisalsPerSession` cap the
   spend, and a slow appraisal is single-flighted so it never runs twice.
7. **Three consent levels for session context.** The `agent` runtime (`runtime:
   "agent"`) reads the same evidence by default; `digest` and `fork` widen what leaves
   the machine and are only set as a persisted decision, never by a one-run flag. See
   [`docs/adr/0002-agent-runtime.md`](docs/adr/0002-agent-runtime.md).

---

## Configuration

`model` is a `provider/modelId` handle, so it selects a provider **account** as well
as a model. This workshop runs several OpenRouter accounts side by side via
`pi-openrouter-accounts` (each account registers as its own provider id, e.g.
`openrouter-default`, `openrouter-soukr`), which is how the three roles get their own
models and their own budget: worker on the main account, psychologist on the
free-tier account, and — later — the reviewer on the main account where capability
actually pays. Mapping, rules and verification: **[`docs/models.md`](docs/models.md)**.

Cascade: defaults ← `~/.pi/agent/pi-devs-psychologist.json` ← `<cwd>/.pi/pi-devs-psychologist.json` (project wins).

```json
{
  "enabled": true,
  "model": "",
  "runtime": "api",
  "agent": {
    "model": "",
    "thinking": "",
    "context": "evidence",
    "timeoutMs": 180000,
    "maxToolCalls": 25,
    "maxCostUsd": 0.25,
    "maxCostUsdPerSession": 2,
    "allowWeb": true,
    "allowMcp": true,
    "allowNlm": true,
    "nlmNotebooks": [],
    "extraArgs": [],
    "keepTranscript": false
  },
  "roles": {
    "scout": {
      "enabled": false,
      "workshopDir": "D:\\01_programovani\\pi\\plugins"
    }
  },
  "history": {
    "enabled": false,
    "retentionDays": 90,
    "path": ""
  },
  "trigger": "signals",
  "cadenceTurns": 3,
  "triggerThresholds": {
    "failureStreak": 3,
    "recurringFailure": 2,
    "restatement": 1,
    "operatorAbort": 1,
    "staleProgress": 6,
    "compaction": 1,
    "thinkingRaised": 1,
    "delivered": 1,
    "commitUnverified": 1
  },
  "commitCheck": true,
  "maxAppraisalsPerSession": 12,
  "outcomeWindowTurns": 5,
  "cooldownTurns": 6,
  "steerAgent": false,
  "lang": "en",
  "restatementThreshold": 0.6,
  "unscopedWordFloor": 25,
  "idleGapMs": 600000,
  "retainObservations": 600,
  "envFacts": true,
  "mapRepo": true
}
```

### Every key

| Key | Default | Effect today |
|---|---|---|
| `enabled` | `true` | **Live.** Master switch. Off observes nothing and spends nothing |
| `model` | `""` | **Live.** `provider/modelId`. Empty means observation at zero model spend, and the chip reads `psych: signals` |
| `lang` | `"en"` | **Live.** `en` \| `cs` — the chip's own text. Model-facing text stays English in every locale |
| `retainObservations` | `600` | **Live.** Bounds the observation window held in memory |
| `trigger` | `"signals"` | **Live.** `signals` \| `cadence`. `signals` appraises on new evidence; `cadence` is the old turn clock, kept for comparison |
| `cadenceTurns` | `3` | **Live.** Under `trigger: "signals"` the minimum turns between attempts; under `trigger: "cadence"` the exact clock. An attempt restarts the count |
| `triggerThresholds` | see JSON | **Live.** Per-reason trigger thresholds. Each key normalised independently; junk → default |
| `estimateTokens` | `{"input":1500,"output":400}` | **Live.** The assumed prompt size, in tokens, for the model picker's `~$X.XX per appraisal` preview. Override per key; the real prompt grows with the session |
| `commitCheck` | `true` | **Live.** On a successful commit (`git commit`, `git push`, `gh pr create`, `npm publish`) with unverified changes, name it in one notification and one evidence line. Observes only — never blocks; `false` silences it entirely |
| `handoff` | `true` | **Live.** Write a factual session ledger at shutdown (TUI-only, zero tokens) and offer it as one line at the start of the next session. Counts only — no score, no person-level claim. `false` disables both |
| `flowShield` | `true` | **Live.** While this session's delivered `protect_flow` intervention is unresolved, hold the plugin's own cards and notifications until the next `agent_end` (then release them; drop them if the shield clears first). The chip is never held. `false` behaves as before |
| `maxAppraisalsPerSession` | `12` | **Live.** Hard ceiling on *attempts* per session; `0` = unlimited |
| `outcomeWindowTurns` | `5` | **Live.** Turns an intervention is given to prove itself before its outcome (per metric, no aggregate score) is judged. See `/psych effect` |
| `cooldownTurns` | `6` | **Live.** Turns a delivered kind stays "cooling", so the model is warned `do not repeat` it. A kind whose outcomes fail to improve twice is muted outright |
| `steerAgent` | `false` | **Live.** Whether an intervention may enter the working agent's context. Off by default: an observer is not an authority |
| `restatementThreshold` | `0.6` | **Live.** Token overlap at which a prompt counts as a restatement |
| `unscopedWordFloor` | `25` | **Live.** Word count above which an anchor-less prompt is reported unscoped |
| `idleGapMs` | `600000` | **Live.** Gap between prompts counted as an interruption (10 min) |
| `envFacts` | `true` | **Live.** Include the parent-computed environment lines (pi version, pi-lens LSP/format/guard state) among the citable evidence |
| `mapRepo` | `true` | **Live.** Include the objective repo map (file counts, longest file, test-to-source ratio, slice layout) among the citable evidence (T8). Computed once per session by counting lines — file *contents* are never read into the prompt. `false` removes the lines and `/psych` says the map is unavailable |
| `runtime` | `"api"` | **Live.** `api` \| `agent` — which runtime forms the appraisal. `agent` spawns a headless read-only `pi` child with the selected model, pi docs, packages, web, MCP, skills and nlm (see ADR 0002) |
| `agent` | see below | **Live.** Settings for the `agent` runtime. Normalised key by key and merged per key across layers |
| `roles` | see below | **Live.** The optional roles that share the agent runtime. Each has its own consent gate |
| `history` | see below | **Live (opt-in).** The cross-session delivery record (T10). OFF by default — see "Longitudinal history (opt-in)" below |

#### `agent` keys (runtime `"agent"`)

| Key | Default | Effect today |
|---|---|---|
| `agent.model` | `""` | **Live.** `provider/id[:thinking]` for the child agent. Empty falls back to the shared `model` |
| `agent.thinking` | `""` | **Live.** `off` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` \| `max`; `""` = the engine default |
| `agent.context` | `"evidence"` | **Live.** The consent level (D6): `evidence` sends counts only, `digest` adds scrubbed prompt/assistant excerpts, `fork` sends the whole session. Set in a terminal via `/psych context` (a confirm states what leaves the machine) or in the config file |
| `agent.timeoutMs` | `180000` | **Live.** Hard wall-clock cap before the child tree is killed |
| `agent.maxToolCalls` | `25` | **Live.** Cap on the child's tool calls before only `psych_submit` remains |
| `agent.maxCostUsd` | `0.25` | **Live.** Per-run cost cap in USD; `0` = unlimited |
| `agent.maxCostUsdPerSession` | `2` | **Live.** Across-run cost cap in USD; `0` = unlimited |
| `agent.allowWeb` | `true` | **Live.** Whether the child may use the web tools |
| `agent.allowMcp` | `true` | **Live.** Whether the child may use MCP tools |
| `agent.allowNlm` | `true` | **Live.** Whether the child may query NotebookLM |
| `agent.nlmNotebooks` | `[]` | **Live.** NotebookLM notebook ids the child may query |
| `agent.extraArgs` | `[]` | **Live.** Extra argv tokens appended verbatim. An escape hatch |
| `agent.keepTranscript` | `false` | **Live.** Keep the child's JSONL transcript in a temp file for debugging |

#### `roles` keys

The scout role (`/psych scout`, T31) finds whether the pi ecosystem already solves a recurring
friction before anything is built. It is OFF by default: a run spends model money, and it can also
be started automatically when a recurring failure reaches count ≥ 3 on the `agent` runtime — at most
once per fingerprint per session, and never in the same turn as an appraisal.

| Key | Default | Effect today |
|---|---|---|
| `roles.scout.enabled` | `false` | **Live.** Consent gate for the scout role. Off, it runs neither on `/psych scout` nor from a trigger. Agent runtime only |
| `roles.scout.workshopDir` | `"D:\\01_programovani\\pi\\plugins"` | **Live.** The operator's plugin monorepo the scout is told to read (README files only, never edit). `""` omits the sentence from the child's brief |
| `roles.reviewer.enabled` | `false` | **Live.** Consent gate for the reviewer role. Off, it runs neither on `/psych review` nor on a delivery boundary. Agent runtime only. It is its own gate because the reviewer reads the repo's source code with a model that leaves the machine (ADR 0001) |
| `roles.reviewer.model` | `""` | **Live.** `provider/id` for the review. Empty = the shared `model`, and the card then says "same model as the working agent" (a reviewer on the worker's model shares its blind spots) |
| `roles.reviewer.maxDiffBytes` | `200000` | **Live.** The cap on the combined diff the child is told to read. Past it, it reviews the last `maxDiffBytes` and says in `text` what it left out |
| `roles.reviewer.conventionFiles` | `["AGENTS.md","CLAUDE.md","CONTRIBUTING.md",".pi/rules.md"]` | **Live.** The repo's stated rules the child reads. `[]` means it cannot check convention adherence |

#### `history` keys (opt-in)

Off by default, and the only feature that stores anything beyond a session. What may be stored is
pinned in "Longitudinal history (opt-in)" below.

| Key | Default | Effect today |
|---|---|---|
| `history.enabled` | `false` | **Live.** The only switch that starts writing the record. Off, nothing is written and nothing is read |
| `history.retentionDays` | `90` | **Live.** Lines older than this are dropped on read and removed by the next append |
| `history.path` | `""` | **Live.** Override for the JSONL path. Empty means `<cwd>/.pi/psych-history/history.jsonl` |

Coercion, so a typo degrades instead of breaking the session: junk numbers fall back to
the default; `model` must be a string, and an unparsable one becomes `""` rather than a
guess at which model you meant; an unknown `lang` becomes `en`; `0` is a real value for
the budget (unlimited). The two layers merge **per key**, so a project patch never freezes
the values it inherits.

**Pick a model the working agent is not.** An observer that shares the worker's blind
spots is not an observer. A different *account* is not automatically a different
*model* — check the model id, not just the provider. See [`docs/models.md`](docs/models.md).

---

## Command

| Command | Effect |
|---|---|
| `/psych` | Report: the observed signals and the last appraisal |
| `/psych now` | Form an appraisal immediately, consuming budget |
| `/psych ask <question>` | Consult the observer directly. Runs the agent runtime (falls back to a tool-less API call on `runtime: api`, and says so). One card: the answer, its cited evidence, researched suggestions. Consumes budget; an uncited answer is marked unsupported, never hidden |
| `/psych scout [topic]` | Find an existing plugin for recurring friction, or a gap worth building. Agent runtime only, behind `roles.scout.enabled`. The topic defaults to the top recurring fingerprint. One card: candidates (name, fit, why, install spec, url) and, when nothing fits, a paste-ready SPAI idea line. When nothing is found and the operator asked, it says so — never silently |
| `/psych review` | Review the change since the last delivery against the repo's stated conventions. Agent runtime only, behind `roles.reviewer.enabled`. Runs one now, ignoring the once-per-delivery rule but not the budget. One card: the delivery anchor, one finding class (or the one-line abstention) with its rule and citation |
| `/psych effect` | Table of delivered interventions per kind: delivered, improved, unchanged, worse, followed. Session-scoped, width-safe |
| `/psych replay <session-file> [--run] [--model <provider/id>] [--cadence <n>] [--json <file>]` | Replay a past session offline. **Dry by default** (no model call, zero spend); `--run` sends each window through one API completion. Consumes no budget and is never recorded in the outcome ledger — it is a measurement, not an observation of the operator |
| `/psych replay --eval <before.json> <after.json>` | Compare two `--json` result files: verdicts kept, claims dropped, citation rate, precision, abstention rate and citations per finding, per run, with a per-window before/after. Pure arithmetic — no model, no session file |
| `/psych on` / `off` | Master switch |
| `/psych model <provider/id>` | Choose the psychologist. The value completes from the engine's registered models and providers (use `--global` to make it machine-wide) |
| `/psych budget <n>` | Appraisals per session (`0` = unlimited) |
| `/psych lang <en\|cs>` | UI language (model-facing text stays English) |
| `/psych runtime <api\|agent>` | Which runtime forms the appraisal. `agent` runs the observer as a headless read-only pi child |
| `/psych context <evidence\|digest\|fork>` | How much session context the child agent may see. `digest`/`fork` open a confirm stating what leaves the machine; outside a TUI they are refused — set `agent.context` in the config file |
| `/psych agent-model <provider/id>` | Model for the child agent (empty = the shared `model`). Completes from the engine's registered models |
| `--global` (trailing) | On any setting command: write to `~/.pi/agent` instead of the project |

When an appraisal has an intervention, it arrives as a **card** — verdicts with the evidence
lines they cited, and the one intervention underneath. `esc`/`enter`/`ctrl+c` closes it;
`PgUp`/`PgDn` scrolls the verdicts when the terminal is short, and the intervention is never
scrolled away. Where a card cannot render (RPC, `json`/`print` modes) the same intervention
arrives as a notification instead. Silence is the normal outcome, not a failure.

---

## Research grounding (NotebookLM)

The agent runtime can query the literature the prompt rules come from instead of reciting it.
`docs/research-notes.md` was distilled from one NotebookLM notebook (92 sources: Amabile & Kramer,
Deci & Ryan, Schultz, Zeigarnik, Leroy, DevEx and the AI-specific findings), and the child may query it.

1. `nlm login` once on the machine (the child runs `nlm login --check` and skips NotebookLM if it fails;
   it never logs in itself).
2. Allow the notebook: `"agent": { "allowNlm": true, "nlmNotebooks": ["<notebook-id>"] }`.
   Only listed ids are queryable, and only listed ids are accepted as a suggestion source (`nlm:<id>`).
3. Ask: `/psych ask What does the research say about <x>?` — the answer carries a `nlm:<id>` source.

Measured on this machine (0.6.0, deepseek-v4.1-flash): one `nlm notebook query`, 3 tool calls, 81 s.
NotebookLM is the slow part; keep `agent.timeoutMs` ≥ 180000 when it is allowed.

## Replay and eval

A prompt change is a hypothesis. This harness lets it be measured instead of argued: it folds a
**past** session file into the same observation windows the live appraiser would have produced and
runs the appraisal offline. It reads real sessions, so the numbers come from the operator's own work.

**The four-step loop.**

1. **`/psych replay <session-file> --dry`** — fold the windows only (the default), no model call. See
   how many windows the session makes, why each would have fired, and how much evidence each carried.
2. **`/psych replay <session-file> --run --json before.json`** — run the appraisal once per window
   through the configured model (or `--model <provider/id>`), writing the per-window results to a file.
3. **Edit the prompt** (`src/shared/prompt.ts`) — or change a threshold, or a filter.
4. **`/psych replay <session-file> --run --json after.json`**, then
   **`/psych replay --eval before.json after.json`** — the table compares the two runs. A change that
   lowers `citation rate` or raises `claims dropped` is worse by these numbers, and that is the point.

Session files live under `~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<uuid>.jsonl`.

**`--json` file format.** One object per run:

```json
{
  "version": 1,
  "sessionFile": "…/<timestamp>_<uuid>.jsonl",
  "mode": "run",
  "model": "provider/id",
  "windows": [
    { "windowIndex": 0, "reasons": ["failure_streak"], "liveLines": ["…"], "sessionLines": ["…"],
      "responseText": "<the model's own JSON answer>",
      "enforcement": { "appraisal": { }, "unmatched": [], "downgraded": [] } }
  ]
}
```

The `liveLines`/`sessionLines` are the evidence **lines** (counts and names), never the transcript —
the same data boundary a live appraisal obeys. `--eval` reads only the `windows` array.

Options: `--dry` (default) / `--run`, `--model <provider/id>` (defaults to `model`; always the direct
API call, never the agent runtime, never a child process), `--cadence <n>` (defaults to `cadenceTurns`),
`--json <file>`. If the file cannot be read, the command notifies with the path and the reason.

## Token economy

- **Zero tokens when `model` is empty.** Observation and `/psych` cost nothing.
- An appraisal sends the config-selected model only the evidence lines plus a
  bounded tail of the transcript — never the whole session.
- Rendering is TUI-only; a report on screen costs no model tokens at all.
- The psychology references ship in `docs/research-notes.md`, not in the prompt.

---

## Two roles, planned as two

The observer sees *how* as well as *how much* — `edit` and `write` carry the change
content in their arguments today and this plugin currently keeps only the path. So the
same position could also act as a **reviewer**: run the work on a model affordable in
volume, review it with a stronger one at delivery boundaries.

It is a **separate role with a separate consent gate**, never a switch on this one.
The psychologist reads counts; the reviewer reads content that can leave the machine.
Enabling the one must not silently opt you into the other. The decision, the VSA shape
and the invariants are in [`docs/adr/0001-two-roles-one-observer.md`](docs/adr/0001-two-roles-one-observer.md).

### Reviewer role

The reviewer is not a second auditor. It is one run on the already-proven agent seams: it
reads the diff since the last delivery (`git diff <lastHead>..HEAD` plus the working tree,
read by the child itself — the parent never retains change content) and the repo's stated
conventions, and proposes **at most one finding**, or abstains.

- **Its own consent gate.** `roles.reviewer.enabled` (default `false`), separate from the
  psychologist's `model`. It reads source code with a model that leaves the machine, so
  enabling a mood chip must never opt you into a code review.
- **It proposes only.** No file mutation, no tool interception, no authority. Nothing is
  ever sent to the working agent, and nothing is written to disk.
- **It cites a stated rule.** A finding stands only on a stated rule read from a convention
  file, or on a session intent line copied exactly. No citation, no claim.
- **It abstains with `insufficient_context`.** That is the default answer, a first-class
  outcome, not a failure: a reviewer without the worker's full context is structurally prone
  to confident wrongness.
- **The "same model" disclosure.** With `roles.reviewer.model` empty, the reviewer runs on the
  shared `model` and the card says so — an observer that shares the worker's blind spots is
  not a strong reviewer.

Trigger is the delivery boundary: a successful `git commit`/`git push`, a `/label` bookmark,
or `/psych review`. At most once per delivery (per commit head), agent runtime only, sharing
the budget, the session cost cap and single-flight with the appraiser.

---

## Handoff

At `session_shutdown`, once the observer has run, the plugin writes one **factual ledger** of
what the session left open — unverified mutations, the last failing tool and its failure
signature, bookmarks still set, delivered interventions whose outcome window never closed, and
the session's tool-call/failure totals. It is stored as a TUI-only session entry (never a file,
never a message, never in model context) and costs zero tokens: it is arithmetic over what the
session already recorded. No score, no mood word, no claim about the person.

Nothing is said at shutdown. The ledger is offered at the **start of the next session** as one
notification line with those counts, once (a marker entry stops a reload or a resumed session
from repeating it). The line also names the most-mutated file still unverified, `(top: file.ts)`, so
the honest count has a subject. Config `handoff` (default `true`) turns both the write and the offer
off.

## Longitudinal history (opt-in)

`/psych history` shows a cross-session record of **delivery events and session counts**, so that
"verified progress has thinned out" can be answered without reading anyone's prompts. It is **off by
default** (`history.enabled: false`): until you turn it on, nothing is written and nothing is read.

**What is stored**, in one JSONL file per project (`<cwd>/.pi/psych-history/history.jsonl`, override
with `history.path`), one line per event and exactly two kinds of line with exactly these keys:

```
session  { at, turns, toolCalls, failures, verifiedRuns, unverifiedMutations }
delivery { at, kind, verdict, followed }   verdict: improved | unchanged | worse | unresolved
```

**What is never stored:** no prompt text, no message bodies, no file paths, no tool names, no model
names, no session identifier, no score, no streak, no rate, no per-day trend, and no word that reads
the operator. The row set is pinned by an exact-key-set test, and the report is asserted against the
PRD §5 prohibited-word list, in `test/history-record.test.js`.

**Retention.** A line older than `history.retentionDays` (default `90`) is skipped on read and
removed the next time the record is appended; the directory is created on the first write and never
by a read. A line that does not match one of the two shapes is dropped, not repaired.

**Erasure.** The record is that one file. Deleting it removes the record; there is no clear command
because there is nothing else to clear — the report names the path it read. Since the plugin keeps
no session identifier, the record cannot be joined back to any session.

## Status

`0.8.1` — **complete.** It observes, appraises when the evidence carries something new, names unverified commits, measures whether its interventions help, can run the observer as a read-only pi agent (`runtime: "agent"`) with web, MCP, skills and pi docs, shows the appraisal as a card,
answers `/psych`, `/psych ask`, `/psych scout`, `/psych review` and `/psych history`, and replays a
past session offline to eval a prompt change (`/psych replay`). 737 tests.

Live today: the observation window, the session-history fold, the appraiser with its budget, the
appraisal card, the delivery policy (card → notification → steering, off by default), the
`/psych` command and report, and the statusline chip. The reviewer role (T32a) is built. Next:
persistence of the last appraisal across `/reload` (T7) and the structural mapper (T8). See
`TASKS.md`.

MIT.