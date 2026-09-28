# ADR 0001 — Two roles, one observer: psychologist and reviewer

**Status:** accepted as design, deliberately **not implemented**
**Date:** 2026-09-28
**Supersedes:** nothing. **Amends:** PRD §5 prohibition 7, which is hereby scoped to the psychologist role.

---

## Context

The operator observed that the observer already has full session context, so it also
sees *how* the work is being done — and could therefore double as a pair
programmer, reviewing code quality and convention adherence. The chosen model for
the review would matter: a stronger observer behind a cheaper worker buys review
coverage that the worker's own model cannot provide.

Before deciding anything, the premise was checked against the published tool
schemas rather than assumed:

| Tool | Argument shape (verified) | Where from |
|---|---|---|
| `edit` | `{ path, edits: [{ oldText, newText }] }` | `dist/core/tools/edit.d.ts` |
| `write` | `{ path, content }` — the whole file | `dist/core/tools/write.d.ts` |
| `edit` details | `{ diff, patch, firstChangedLine }` | `dist/core/tools/edit.d.ts` |

`tool_execution_start.args` is forwarded to extensions verbatim
(`agent-session.js`: `args: event.args`). `src/slices/observer` already reads that
event and currently keeps **only `path`** — the change content is seen and
discarded on every edit.

**So the question is not whether the plugin can see the work. It does. The question
is whether it should look at it for a second purpose, and under whose consent.**

---

## Decision

One repository, **two roles**, and they are never one switch:

| | `psychologist` | `reviewer` |
|---|---|---|
| Subject | the person, the session | the artifact, the change |
| Reads | counts and names (evidence lines) | change content and convention sources |
| Model | a different model from the worker's | a different model from the worker's |
| Cadence | every N turns (`cadenceTurns`) | delivery boundaries, event-anchored |
| Budget | ~7 short evidence lines | sampled code, capped per review |
| Consent gate | `model` non-empty | `reviewer.enabled` **and** its own model |
| Failure cost | shrug | changing correct code on a weaker reading |
| Output | at most one intervention | proposals only, never writes |

Two consent gates is the load-bearing part of this decision. The psychologist reads
*counts*; the reviewer reads *content that can leave the machine*. Enabling a mood
chip must never silently opt the operator into sending their source code to a second
model.

---

## Why the reviewer role is worth building

1. **Capability arbitrage — the operator's argument, and the strongest one.** Today
   review is the expensive step, done by a human, and it is where defects are made
   or caught. A cheaper worker plus a stronger observer inverts that: the
   high-capability model is spent where judgement pays (review) instead of where
   volume dominates (typing). This is PRD §3's "different model, no shared blind
   spots" argument with an economic edge added.
2. **The capture cost is already paid.** The change content is in flight. Marginal
   cost of *looking* is a retention decision, not an integration project.
3. **Plan-versus-artifact mismatch is a genuinely new signal.** The observer sees
   the declared intent (assistant text) *and* the resulting diff. "The agent said it
   would clamp the width; the diff touched three unrelated files" is mechanical
   detection of a mismatch that the working agent structurally cannot see about
   itself, and that no linter checks.

---

## Why it cannot be merged into the psychologist role

Each row is a reason the two must stay separable, not a preference:

- **Different consent boundary.** Counts vs content-that-leaves-the-machine.
- **Different failure cost.** A wrong psychological reading is ignorable. A wrong
  review recommendation can change code that was correct, made by an observer that
  does not hold the worker's full context.
- **Different cadence.** Reviewing every edit is a cost sink and a nag. Review
  belongs at delivery boundaries — a verified run, a labelled checkpoint — not on
  every keystroke.
- **Different economics.** Seven evidence lines versus thousands of tokens of code.
  In one budget, the cheap role becomes hostage to the expensive one.
- **Different normative stance.** The psychologist never decides. The reviewer
  proposes. Neither writes.

---

## Architectural shape (VSA)

Exactly one change to existing code is implied, and it is a *shape* change, not a
feature:

**`slices/observer` becomes a raw recorder with a retention policy instead of a
projector.** Today it captures what the signal fold happens to need (`path`, `ok`).
With two consumers, one capture must serve two projections:

```
events ──► slices/observer (bounded raw record, retention policy)
                   │                          │
                   ▼                          ▼
        slices/psychologist            slices/reviewer
        (counts → evidence)      (content → sample → findings)
```

- `retain: "counts" | "content"` in config, **defaulting to `"counts"`**. The data
  captured is therefore a function of what is enabled — which is the honest way to
  express "we only keep code when you asked for code review".
- `slices/reviewer` owns its own model call, its own bounded sample builder and its
  own finding policy. It does not import the psychologist slice.
- `slices/psychologist` is today's appraiser, renamed for symmetry.
- Slices still import only from `src/shared/`; the composition root stays the only
  multi-slice importer. Nothing here bends VSA; it is what VSA is for.

**What is deliberately NOT done now:** no content retention, and no `retain` config
key. Nothing consumes it yet, and retaining source code in memory with no consumer
is pure liability — especially in a plugin whose stated discipline is refusing data
it does not need. Recording the shape is what prevents the reviewer being designed
into a corner later. Adding dead config would be worse than adding nothing.

---

## Invariants the reviewer must satisfy

Written now because they are cheap to state and expensive to retrofit:

1. **Proposes, never writes.** No file mutation, no tool interception, no authority.
2. **Abstention is first-class.** `insufficient_context` is a legitimate outcome, and
   the default answer is silence. A reviewer without the worker's context is
   structurally prone to confident wrongness; it must be able to decline.
3. **Convention adherence requires a *stated* convention.** It must read the repo's
   stated rules (`AGENTS.md` and equivalents). You cannot check adherence to a rule
   nobody wrote down, and inventing one is the reviewer equivalent of fabricating
   evidence.
4. **No style opinions without a citable rule.** Same discipline as the psychologist:
   no citation, no claim.
5. **Bounded output.** One finding class per review, hard cap on findings.
6. **Never reviews its own work.** The reviewer's model must not be the worker's, for
   the same reason as PRD §3.
7. **Findings are addressed to the operator**, never injected as instructions the
   working agent will act on silently.

---

## Consequences

**Positive:** the psychologist ships alone and unchanged; the expensive model is used
where it pays; the two roles share one capture path instead of duplicating it.

**Negative, and accepted:** two model budgets and two configs to surface; content
retention means source code in plugin memory, so it must be bounded and **never
written to disk**; two failure modes to report honestly.

**Risk:** it degenerates into a nagging linter with opinions. Mitigated by the
abstention default, delivery-anchored cadence, and invariant 3.

---

## What would prove this decision wrong (check when built)

- **If fewer than half its findings are accepted**, it is noise, and the abstraction
  is not worth its surface. Delete the slice rather than tune it.
- **If it duplicates `pi-lens` or `pi-architecture-watcher`**, it should not ship.
  Those are deterministic and free. The reviewer's only justification is *semantic*
  judgement — convention mismatches, plan-versus-artifact drift, intent that the
  diff contradicts — which deterministic tools cannot express.
- **If it starts advising on architecture**, it has drifted into the worker's job and
  out of its evidence.