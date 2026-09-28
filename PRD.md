# PRD — pi-devs-psychologist

**Date:** 2026-09-28
**Author:** pi-plugin-dev (workshop), requester: Jaroslav
**Status:** design accepted; T1 landed, T2–T11 in `TASKS.md`
**Planned repo:** `git:github.com/mastnacek/pi-devs-psychologist`
**Type:** Pi extension (observer model + appraiser tool + prompt policy)
**Research base:** NotebookLM notebook *"pi-quick-win: Psychologie a design malých
programátorských vítězství"* — 92 sources, distilled in `docs/research-notes.md`
**Prior art:** `docs/inspiration.md`

---

## 1. The problem

The operator works with an agent for hours. During those hours the agent reports
**activity**, and only occasionally reports **delivery**. Nobody in the loop has a
view of what is happening *to the person doing the work*:

| What exists today | What is missing |
|---|---|
| The agent's own summary of its changes | Whether the session is producing **verified progress** or only motion |
| Context-usage and cost meters | Whether cognitive load is being spent on **authoring** or on **validating** |
| A todo list | Which loops are **open and unnamed**, and which one to close next |
| Model selection | A **second opinion from a different model**, one that is not inside the work |

The working agent cannot supply this. It is the subject: it cannot see that the
prompt was restated twice, that the same file was rewritten four times, that
eleven turns have passed since anything was proven to run. Its context contains
its intentions, not the session's record.

## 2. What this is

A **second model** — explicitly a *different* model from the one doing the work —
which:

1. **observes** the session through objective signals (T1, landed),
2. **appraises** motivation, cognitive load, progress and flow against the
   developer-psychology literature (T3),
3. **names at most one intervention** with cited evidence (T5),
4. **never diagnoses, never scores, never decides** (design prohibitions).

## 3. Why a different model

An observer sharing the working model's blind spots is not an observer. The
working model is inside a plan it authored; a second model reading the *record* is
the only cheap source of an outside view. It also means the appraisal is not
shaped by the working agent's own narrative of how well it is doing.

The plugin is explicit about this in `README`: pick a model the worker is not.

The handle is `provider/modelId`, so "different model" and "different provider account"
are both available and both used: this workshop runs several OpenRouter accounts
side by side, each registered as its own provider id, which is how the psychologist
gets its own model *and* its own budget. The role → account mapping is in
`docs/models.md`. Notably, a low-cadence observer (~7 evidence lines every
`cadenceTurns`) is precisely the workload that fits a free-tier account, so the second
opinion can cost nothing extra while the work account's quota stays untouched.

## 4. The evidence discipline (the actual invention)

A model asked "how is the programmer doing?" will invent an answer. Everything
else in this design follows from refusing that.

```
events ──► observation window ──► arithmetic signals ──► evidence lines
             (T1, no model)          (T1, no model)         (counts only)
                                                              │
                                                              ▼
                                              appraiser model (T3, cited output)
                                                              │
                                          intervention policy (T5, max 1)
```

Three rules make it non-fabricating:

1. **The model never produces a number.** Every figure it may mention was computed
   by arithmetic it cannot influence.
2. **Every interpretive claim must cite an evidence line.** No citation, no claim.
   The schema (T3) enforces this structurally.
3. **Heuristics are named for what they measure.** `promptsWithCorrectionMarkers`
   counts marker matches. It does not assert the programmer was correcting — the
   interpretation must be cited to the count and can be checked.

Together this makes the appraisal **auditable**: disagree with a conclusion and
you can read the events that produced it. `pi appendEntry` persistence (T7) stores
the appraisal, never a derived judgement about the person.

### 4.1 Data boundary

The session record contains the prompt's own sections, skill manifests, tool
declarations and every message body. **None of it may reach the second model.** The
appraiser receives the evidence lines — counts and names — plus a bounded tail of the
conversation, and nothing else. A psychological reading of a session is not a licence
to read the session.

Two refusals are load-bearing enough to name here; the rest are enumerated with
reasons in `docs/session-data.md`:

- **No cost or token-spend totals.** Money pressure is a different conversation from
  cognitive load, and it would turn "how are you doing" into "you cost me X" — a
  meter rather than a colleague. Cost reporting is `pi-model-pricing`'s job.
- **No other plugin's `custom` entries.** A peer's private state is not evidence
  about a person, and reading it would couple two repos for no signal. This is the
  same reason the `pi-quick-win` integration is prompt-level (§8).

Reading the session is also scoped to the current branch: `getBranch()`, never
`getEntries()`. After `/tree` the latter would fold in work the operator *abandoned*,
and reporting abandoned work as progress is precisely the invention this design
exists to prevent.

## 5. Hard prohibitions

Each is required by a specific finding, not by taste:

| Prohibition | Required by |
|---|---|
| No points, streaks, badges, leaderboards | Overjustification effect — Deci, Koestner & Ryan (1999) |
| No productivity scoring, no cross-session person record | Same; plus it is the difference between a tool and surveillance |
| No diagnosis of burnout, fatigue or any condition | Scope. The tool notices a stretch without verified progress and stops there |
| No invented praise or invented progress | Reward prediction error — a false reward signal is trained away |
| Never more than one intervention | Zeigarnik: a list of open loops is itself load |
| Never decide for the programmer | Self-determination theory: autonomy is the need agentic work most damages |
| No opinion about the code's design — **in the psychologist role** | That is the working agent's job; the psychologist's job is the session. A second role with a separate consent gate would *propose* on the artifact (§10, ADR 0001) — it would still never write |

## 6. Architecture (VSA)

```
index.ts                          composition root: state + slice wiring only
src/shared/
  signals.ts    observation types, the fold, evidence lines      [landed]
  lexicon.ts    every heuristic pattern table, one screen        [landed]
  state.ts      session kernel: window, pending tools, budget    [landed]
  config.ts     cascade + coercion; model:"" means no spend      [landed]
  i18n.ts       en/cs UI copy; model-facing text stays English   [landed]
  status.ts     the one statusline slot                          [landed]
  version.ts    build stamp
  model-call.ts nested model call + auth + usage                 [T2]
  prompt.ts     the appraiser system prompt (English)            [T3]
  appraisal.ts  TypeBox schema; interventions max length 1       [T3]
src/slices/
  observer/     events → observation window                      [landed]
  appraiser/    cadence, budget, single-flight → model           [T4]
  interventions/ at most one delivery                            [T5]
  report/       /psych report rendering                          [T6]
  commands/     /psych + completions                             [T6]
  mapper/       objective codebase map, no LLM                   [T8]
```

Slices never import each other; the composition root is the only multi-slice
importer. Files stay under 400 lines.

## 7. Cost model

Token economy is a first-class requirement, because an observer that costs more
than it gives is a net loss to the session it is watching.

| State | Cost |
|---|---|
| No `model` set (default) | **Zero model tokens.** Observation and `/psych` still work |
| Appraisal | Evidence lines (~7 short lines) + bounded transcript tail. Never the whole session |
| Rendering | TUI only; on-screen text costs no model tokens |
| Research/design docs | Not in the prompt; loaded only when developing the plugin |
| Idle | No timers, no watchers, no polling |

Hard caps: `cadenceTurns` (default 8), `maxAppraisalsPerSession` (default 12, on
**attempts** rather than successes because a failed call may still be billed), and
single-flight so a slow appraisal never doubles the spend.

**Measured gap, worth knowing:** the engine cannot be told about these calls.
Extensions receive a `ReadonlySessionManager`, a `Pick<…>` of read-only methods with no
`appendUsage`, so the session's own token and cost meter does **not** include appraisals.
The skill's "include usage in the tool result" rule has no equivalent here — a tool can
report usage because the engine is waiting on its result, and a slice called from
`turn_end` has no such seam. The plugin therefore reports its own spend itself
(`state.lastAppraisalUsage`, surfaced by `/psych`) instead of implying the engine counted
it. On a free-tier account this costs nothing; on a paid one, budget for a second meter.

## 8. Merge with `pi-quick-win`? — recommendation: **no**

Both are about momentum, so the merge is tempting. It should not happen, for four
reasons:

1. **Incompatible cost invariants.** `pi-quick-win`'s PRD §6 commits it to adding
   ≤ ~150 tokens to a session and to zero model spend. This plugin is inherently
   model-backed. One repo cannot hold both invariants; the weaker one always wins
   in practice, and quick-win would silently acquire a model dependency.
2. **Different failure modes.** If the psychologist's model call fails, the card
   must still appear and the echo must still be true. Merged, they share a state
   kernel, a config file and a budget; a failure in one becomes a failure in both.
3. **Different opt-in.** A user may reasonably want the card without an observer
   watching their session. Merged, they get one switch for two decisions.
4. **The coupling is already one-way and narrow.** The psychologist's desired
   action — "name the smallest shippable increment" — is exactly what quick-win
   already exposes as a tool. That is reachable **through prompt policy**: the
   working agent is instructed to call `quick_win` when the appraisal says a long
   stretch has produced no verified increment. Zero imports, zero shared state,
   and either plugin still works alone.

**Decision:** two repos, one documented prompt-level integration contract (T9).
The merge will be reconsidered only if the psychologist needs to *render*
quick-win's card, which today it does not.

## 9. What would make this fail

Recorded up front, so it can be checked later:

1. **It becomes a nag.** Mitigated by: one intervention, cadence, budget, and the
   preference for silence over a weak observation.
2. **It becomes a score.** Mitigated by prohibition §5; any future feature that
   trends a number about a person is out of contract.
3. **Its psychology is decorative.** Mitigated by `docs/research-notes.md`, which
   ties each rule to a finding, and by the evidence discipline: if the signals
   cannot support a claim, the claim is not made.
4. **It costs more than it gives.** Mitigated by §7, and by the default of
   `model: ""` — installing the plugin cannot cost anything by itself.

---

## 10. A second role: the reviewer (accepted as design, not built)

The observer sees *how* as well as *how much*: `edit` and `write` carry the change
content in their arguments today and the plugin discards all but the path (verified,
ADR 0001 §Context). That makes a second role nearly free to capture and genuinely
valuable: run the **work** on a model affordable in volume, and the **review** on a
stronger one, at delivery boundaries rather than per keystroke.

It is a separate role with a **separate consent gate**, never a switch on this one: the
psychologist reads counts, the reviewer reads content that can leave the machine, and
enabling a mood chip must not silently opt the operator into sending their source code
to a second model.

The full decision — why it cannot be merged, the VSA shape (`slices/observer` becomes a
recorder with a `retain: "counts" | "content"` policy so one capture serves two
projections), the invariants it must satisfy, and the criteria that would prove it
wrong — is in **`docs/adr/0001-two-roles-one-observer.md`**. Tasks: T12a–T12e.

Nothing is implemented: no content retention and no `retain` key, because nothing
consumes it yet and retaining code with no consumer is liability. Recording the shape
is what keeps the reviewer from being designed into a corner.