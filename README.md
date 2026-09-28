# pi-devs-psychologist

**A second model watches the session as an engineering psychologist.**

The working agent does the work. This plugin runs a *different* model alongside
it that reads what actually happened — prompts, tool outcomes, churn, verified
progress — appraises the programmer's **motivation, cognitive load and progress
against the published research on developer psychology**, and names **at most one
intervention**. Every claim it makes is traceable to a number it was given.

```bash
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
  "model": "openrouter-soukr/<a :free model>",
  "cadenceTurns": 8,
  "maxAppraisalsPerSession": 12,
  "steerAgent": false,
  "lang": "en"
}
```

Set it from the session instead: `/psych model <provider/id>`, `/psych budget 6`,
`/psych on|off`, `/psych global`.

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
| `/psych model <provider/id>` | Choose the psychologist |
| `/psych budget <n>` | Appraisals per session (`0` = unlimited) |
| `/psych lang <en\|cs>` | UI language (model-facing text stays English) |
| `/psych global` | Write settings to `~/.pi/agent` instead of the project |

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

`0.0.3` — the observation kernel, the session-history fold and its data boundary are
landed and tested (57 tests). The appraiser (T2–T4), the intervention policy and
`/psych` are next; the reviewer role is designed and deliberately unbuilt (T12).
See `TASKS.md`.

MIT.