# Research notes — what the appraiser is allowed to cite

Distilled from the NotebookLM notebook *"pi-quick-win: Psychologie a design malých
programátorských vítězství"* (92 sources; the three generated syntheses are source
ids `9ea21966`, `d1f5eacf`, `f04d05df`, re-fetchable with `nlm source content <id>`).

**This file is not in the model prompt.** It is the reference the appraisal rules
are derived from, loaded when the prompt is edited — not paid for on every turn.
That is deliberate: quoting research at a model every 8 turns is a token sink, and
the *rules* are what actually change its behaviour.

Each entry below ends in the **operational rule** it forces on this plugin.

---

## 1. The Progress Principle — Amabile & Kramer

12,000 diary entries, 238 knowledge workers, seven organizations. The strongest
influence on *inner work life* (emotion, motivation, perception) was not a big win
and not a reward: it was **small progress in meaningful work**. The worst day was
not a failure day — it was a *blocked* day: you worked and did not advance.
Obstacles and setbacks damage mood roughly two to three times more than a single
breakthrough improves it.

**Rule:** the appraisal must name **verified delivered progress** or state plainly
that there is none. "Lots of activity" is not progress and may not be presented as
such. `verificationRuns` and `turnsSinceVerifiedProgress` exist for exactly this.

---

## 2. Self-determination theory — Deci & Ryan

Intrinsic motivation rests on **autonomy, competence, relatedness**. In
agent-assisted work each has a specific failure mode:

| Need | What agentic work kills | Operational rule here |
|---|---|---|
| Competence | "I don't know whether what I'm doing lands" | Every claim must cite a concrete verified fact |
| Autonomy | The agent chooses direction; the human watches | The plugin may **never** decide; it names at most one option and hands the choice back |
| Relatedness | The work is silent | The appraisal is addressed to the person, not logged as telemetry |

The literature's term for the autonomy collapse is the *passive spectator*
syndrome: the engineer becomes a validator rather than an author.

---

## 3. Reward prediction error — Schultz

Dopaminergic neurons encode `RPE = received reward − predicted reward`, and fire
strongly on the **prediction** of reward, not only on receipt.

**Rules:** the signal must be **immediate** (late reward does not update the
prediction), **unconditional and true** (a false signal is learned as noise and
then ignored), and **tied to a concrete action**. This is the strongest argument
against inventing praise: a fabricated progress signal is not merely dishonest, it
is *trained away* by the reader within days.

---

## 4. Goal gradient + Zeigarnik

**Goal-gradient (Kivetz, Urminsky & Zheng, 2006):** effort rises as a visible goal
approaches. A named near goal is not a comfort — it changes the work rate.
**Zeigarnik:** unfinished tasks stay resident and generate *task-specific tension*;
naming the next concrete target closes the loop and frees the capacity.

**Rule:** when there are open loops, name **at most one** of them concretely. A
list of open loops is itself a load, not a relief.

---

## 5. Overjustification — Deci, Koestner & Ryan (1999)

Expected external tangible reward **reduces** intrinsic motivation, and the effect
is robust. The gamification literature (including the negative-result study on
digital fitness apps) documents the same failure in tooling.

**Rule — a prohibition, not a preference:** no points, no streaks, no badges, no
leaderboards, no productivity scores. This plugin measures nothing about a person
across sessions. There is no persisted score, by design.

---

## 6. DevEx — Noda, Storey, Forsgren & Greiler

Three dimensions drive developer productivity and wellbeing:

- **Feedback loops** — the speed and quality of response to an action.
- **Cognitive load** — the mental capacity demanded to understand code and tools.
- **Flow** — uninterrupted deep focus.

---

## 7. AI-specific findings

- AI-generated code shifts the engineer from *author* to *reviewer*, adding a
  **cognitive validation burden** measured as a rise in perceived workload
  (NASA-TLX). Senior engineers perceive it more sharply, because they spot the
  architectural and security defects immediately and must then verify everything.
- Large AI diffs produce the **"fuzzy mirror"** effect: the engineer burns capacity
  verifying a sprawling change, and the creative satisfaction of authorship is
  replaced by fatigue from cleaning mediocre code.
- Unreviewed AI output is reported at **+38.1% defects**; narrowly scoped AI use
  (targeted question, contextual insert) reduces perceived workload while broad
  agentic use raises exhaustion.
- **Decomposition techniques that work:** thin vertical slicing, `Question
  Stories`, the `Mikado Method` (revert immediately, record the missing
  prerequisite as a graph node, work only leaves), and `Elephant Carpaccio`
  (10–30 minute fully working slices).
- **Quality gates** run before the human sees the output, so the senior's capacity
  is spent on architecture and business logic instead of acting as a linter.

**Rule:** rank a `thin_slice` intervention above a `work_harder` one; treat rising
churn and a growing unverified backlog as cognitive load, not as a work-ethic
problem.

---

## 8. Interface patterns worth reusing

From the synthesis of Claude Code / Aider / Cursor / Windsurf interactions:

| Pattern | What it protects |
|---|---|
| Micro-shippable checkpoints | Continuous perception of meaningful advance |
| Stepping & override control | Control over the process |
| Contextual diff annotations | Understanding of the codebase |
| Predictive chain-of-thought streaming | Frustration from opaque failure |
| Explicit loop-closure cues | Working-memory capacity |
| Value-driven feedback | Protection against overjustification |

**Rule:** the psychologist's note obeys `Explicit loop-closure cues` and
`Value-driven feedback` — short, concrete, one item.

---

## 9. Context and fatigue epidemiology

Sources on this include the Haystack burnout survey (83% of developers reporting
burnout) and the darker 2026 material on GenAI adoption and strain
(*From Gains to Strains*), plus the *Bad Days* mixed-methods study
(arXiv 2410.18379) and *Towards Decoding Developer Cognition in the Age of AI
Assistants* (arXiv 2501.02684).

**What this plugin takes from it:** exactly one capability — noticing a long
stretch with no verified progress. It does **not** diagnose burnout, does not
claim clinical standing, and does not assess a person. The scope boundary is a
design requirement, not modesty: a tool that labels someone burned out will be
uninstalled, and would be wrong while it lasted.