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
  "cadenceTurns": 8,
  "maxAppraisalsPerSession": 12,
  "steerAgent": false,
  "lang": "en",
  "restatementThreshold": 0.6,
  "unscopedWordFloor": 25,
  "idleGapMs": 600000,
  "retainObservations": 600
}
```

### Every key

| Key | Default | Effect today |
|---|---|---|
| `enabled` | `true` | **Live.** Master switch. Off observes nothing and spends nothing |
| `model` | `""` | **Chip only until T4.** `provider/modelId`. Empty means observation at zero model spend, and the chip reads `psych: signals` |
| `lang` | `"en"` | **Live.** `en` \| `cs` — the chip's own text. Model-facing text stays English in every locale |
| `retainObservations` | `600` | **Live.** Bounds the observation window held in memory |
| `cadenceTurns` | `8` | **Live.** Turns between appraisals; an attempt restarts the count |
| `maxAppraisalsPerSession` | `12` | **Live.** Hard ceiling on *attempts* per session; `0` = unlimited |
| `steerAgent` | `false` | **Live.** Whether an intervention may enter the working agent's context. Off by default: an observer is not an authority |
| `restatementThreshold` | `0.6` | Pending T3/T4. Token overlap at which a prompt counts as a restatement |
| `unscopedWordFloor` | `25` | Pending T3/T4. Word count above which an anchor-less prompt is reported unscoped |
| `idleGapMs` | `600000` | Pending T3/T4. Gap between prompts counted as an interruption (10 min) |

**"Pending" keys are validated and persisted now but do nothing yet** — the slice that
reads them has not landed, so nothing invokes the fold or the appraiser they configure.
Setting them early is harmless and they start working when their slice ships. They are
listed rather than hidden because a config key that silently does nothing is worse than
no key at all: you would set it, see no change, and stop believing the file.

Coercion, so a typo degrades instead of breaking the session: junk numbers fall back to
the default; `model` must be a string, and an unparsable one becomes `""` rather than a
guess at which model you meant; an unknown `lang` becomes `en`; `0` is a real value for
the budget (unlimited). The two layers merge **per key**, so a project patch never freezes
the values it inherits.

Today the model is set in the config file; the `/psych` command below is **not built yet**
(T2–T6).

**Pick a model the working agent is not.** An observer that shares the worker's blind
spots is not an observer. A different *account* is not automatically a different
*model* — check the model id, not just the provider. See [`docs/models.md`](docs/models.md).

---

## Command

| Command | Effect |
|---|---|
| `/psych` | Report: the observed signals and the last appraisal |
| `/psych now` | Form an appraisal immediately, consuming budget |
| `/psych on` / `off` | Master switch |
| `/psych model <provider/id>` | Choose the psychologist. The value completes from the engine's registered models and providers (use `--global` to make it machine-wide) |
| `/psych budget <n>` | Appraisals per session (`0` = unlimited) |
| `/psych lang <en\|cs>` | UI language (model-facing text stays English) |
| `--global` (trailing) | On any setting command: write to `~/.pi/agent` instead of the project |

When an appraisal has an intervention, it arrives as a **card** — verdicts with the evidence
lines they cited, and the one intervention underneath. `esc`/`enter`/`ctrl+c` closes it;
`PgUp`/`PgDn` scrolls the verdicts when the terminal is short, and the intervention is never
scrolled away. Where a card cannot render (RPC, `json`/`print` modes) the same intervention
arrives as a notification instead. Silence is the normal outcome, not a failure.

---

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

It will be a **separate role with a separate consent gate**, never a switch on this one.
The psychologist reads counts; a reviewer reads content that can leave the machine.
Enabling the one must not silently opt you into the other. The decision, the VSA shape
and the invariants are in [`docs/adr/0001-two-roles-one-observer.md`](docs/adr/0001-two-roles-one-observer.md).

---

## Status

`0.2.0` — **complete.** It observes, appraises on a cadence, shows the appraisal as a card, and
answers `/psych`. 169 tests.

Live today: the observation window, the session-history fold, the appraiser with its budget, the
appraisal card, the delivery policy (card → notification → steering, off by default), the
`/psych` command and report, and the statusline chip. Next: persistence of the last appraisal
across `/reload` (T7) and the structural mapper (T8). The reviewer role is designed and
deliberately unbuilt (T12). See `TASKS.md`.

MIT.