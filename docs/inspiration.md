# Prior art — what exists, and what does not (2026-09-28)

Searched with `gh` (repo, code and skill-manifest searches). Recorded here so the
"is this already solved?" question has a dated answer instead of being re-litigated
every session.

## The mechanism exists — as memory

A second model that observes a session and returns structured observations is a
**known, shipped pattern**. It was invented for *memory*, not for psychology:

| Project | Mechanism | Objective |
|---|---|---|
| `claude-mem` | asks an **observer model** for XML observations + session summaries | persistent memory |
| `agent-memory-atlas` (`neoneye`) | survey of the observer-model family (`claude-mem`, `engram`, …) | memory systems |
| `cognithor` | separate **planner model** and **observer model**, with a *Reflector* writing episodic and semantic memory | agent memory |
| `engram` | MCP session summaries, Go | memory |
| `bbsbot/agent-session-management` | tracks permission prompts as cognitive load in a session skill | session hygiene |

**Conclusion:** the *plumbing* is precedented and cheap to reuse — nested model
call, structured output, sidecar state. This plugin does not need to invent it.

## The objective is not covered

Everything named "developer psychologist" that exists is a **persona over git
history** — entertainment, computed once, offline:

| Project | What it is |
|---|---|
| `rasinmuhammed/reflog` | a "Developer Psychologist" LLM role analysing git activity in a chat app |
| `SKar-2007/gitblame-roast` | "savage developer psychologist" personality card from git stats |
| `SARA-89-dot/coommitlore` | "witty developer psychologist" report from commits |
| `ks815/Psychologist_Agent`, `Safiya123-max/Psychologist-Agent`, and similar | mental-health counseling agents — a different domain, no code context |
| `NeuroSkill-com/skills` | neuroscience protocol skills; health, not software work |
| `davebs/AgileLite`, `reignite/burnout.io`, `daveshap/BurnoutRecoveryIndex` | human-readable methods and inventories, not agents |

Nobody runs a **live, second-model appraisal of the working session against the
developer-psychology literature**, with cited evidence and a bounded intervention.

## Verdict

- **Reuse:** the observer-model pattern, the nested model call, structured output,
  sidecar budget. Available in `pi` already (`ctx.modelRegistry.complete`, proven
  in `pi-solodev-adr/src/translator.ts`).
- **Do not reuse:** the persona/roast framing, and the mental-health framing. Both
  are the wrong objective and the second one is the wrong claim.
- **Novel here:** the evidence discipline (counts in, cited claims out), the
  explicit prohibition on scoring, and the observation→appraisal→single-intervention
  contract with a hard budget.

**Adjacent workshop plugins, deliberately not duplicated:**

| Plugin | Overlap | Why this is still separate |
|---|---|---|
| `pi-quick-win` | both are about momentum | quick-win is the **action surface** (~0 tokens, synchronous, TUI-first). This is the **observation surface** (model-backed, asynchronous, budgeted). Merging would force quick-win to carry a model dependency and a budget, breaking its own zero-token invariant. |
| `pi-architecture-watcher` | both "watch" | that one is a no-LLM static VSA analyser over imports. This one never parses code structure for its signals. |
| `pi-self-compact` | both summarise | that one summarises *for the agent's memory*. This one appraises *for the person*. |
| `pi-lens` | codebase intelligence | the mapper slice (T8) reuses the idea of an objective structural map, without an LLM. |

## Integration instead of a merge

The psychologist, on detecting a long stretch with no delivered increment, wants
the *quick-win card*. It gets it **through prompt policy, not code**: the working
agent is instructed to call `quick_win`. No import, no shared state, no coupling
between two repos — and either plugin works alone, which is the property a merge
would destroy.