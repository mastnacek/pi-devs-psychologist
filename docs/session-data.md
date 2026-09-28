# Session data — what Pi records, and what the psychologist is allowed to use

Study of the engine's session record (2026-09-28, engine `0.87.1`) against the
plugin's need: *what can be additional context for the appraisal, and what may not
be?* The answer is implemented in `src/shared/history.ts`; the refusals are the
more important half of this document.

Sources: the engine's own `docs/session-format.md`, `dist/core/session-manager.d.ts`
(the exported `SessionEntry` union), and how this workshop's plugins already read
the same data.

---

## 1. Where it lives and what shape it is

```
~/.pi/agent/sessions/--<path>--/<timestamp>_<session-id>.jsonl
```

JSONL, one entry per line, **tree-shaped** via `id`/`parentId` — `/tree`
navigation, `/fork` and `/clone` create branches without new files. Version 3
(`hookMessage` renamed to `custom`), auto-migrated on load.

Two read methods, and **they are not interchangeable**:

| Method | Returns | Use for |
|---|---|---|
| `sessionManager.getBranch()` | entries from entry to root, path order | **Anything about the session that happened** — the only correct source here |
| `sessionManager.getEntries()` | every entry in the file, including abandoned branches | History browser, global totals |
| `sessionManager.getTree()` | tree with resolved labels | Structure questions |

`history.ts` uses `getBranch()` and a test asserts `getEntries()` is never
called: after `/tree`, `getEntries()` would fold in work the operator *abandoned*,
and reporting abandoned work as session progress is exactly the kind of invention
this plugin exists to prevent.

Entry timestamps are ISO strings; nested **message** timestamps are ms. Both are
needed and neither substitutes for the other.

---

## 2. What each entry type yields

| Entry | Fields that matter | Signal derived | Adopted |
|---|---|---|---|
| `session` (header) | `cwd`, `timestamp`, `version`, `parentSession` | session identity, fork lineage | identity only |
| `message` / assistant | `stopReason`, `usage`, `timestamp` | **operator cancelled**, provider error, output-limit cutoff, wait time, cache ratio | ✅ |
| `message` / user | `timestamp` | when the human spoke; wait clock | ✅ |
| `message` / system | `sections`, `toolsAdded`, `toolsRemoved` | prompt/tool loadout history | ❌ refused |
| `message` / toolResult | `isError`, `usage` | (already covered live) | via live window |
| `model_change` | `provider`, `modelId` | **the operator rejected the model** | ✅ |
| `thinking_level_change` | `thinkingLevel` | **the operator's own difficulty call** | ✅ |
| `compaction` | `tokensBefore`, `fromHook`, `usage` | context pressure; engine vs extension | ✅ |
| `branch_summary` | `fromId`, `summary` | **an approach was walked away from** | ✅ (count only) |
| `context_edit` | `targetId`, `replacement` | erased vs rewritten model context | ✅ |
| `label` | `targetId`, `label` | **the operator's own progress marks** | ✅ |
| `session_info` | `name` | **the declared purpose of the session** | ✅ |
| `usage` | `kind`, `usage` | cache warming and other non-turn usage | ❌ excluded from the ratio |
| `custom` / `custom_message` | `customType`, `data`, `content` | another extension's state | ❌ refused |

### The three that matter most

1. **`stopReason: "aborted"`** — the operator pressed stop. `StopReason` is
   `"pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred"`.
   This is the strongest frustration evidence available anywhere in the engine, and
   it is a literal field, not an inferred sentiment. Nothing else in the session
   record comes close.
2. **`label`** — `/label`. In a session full of machine activity, this is the only
   place the *human* states where the value was. It is ground truth for the
   Progress Principle: a bookmark is a progress claim made by the person.
3. **`thinking_level_change`** — raising the level is the operator saying "this
   needs more thinking". That is their difficulty calibration. A psychologist
   guessing at task difficulty while the operator has already answered the question
   in a field would be absurd.

Labels deserve one implementation note: a later `label` entry on the same target
**clears** it (`label: undefined`). A cleared label is a mark the operator took
back, so only still-live labels count. A test pins this.

---

## 3. What was deliberately refused, and why

These refusals are the design, not an omission list.

| Refused | Why |
|---|---|
| **Message bodies** (system, skill, tool declarations) | The largest and most sensitive payload in a session. The psychologist needs *counts*, not content. A second model reading your system prompt and skill manifests to form a psychological opinion is a data-boundary violation with no benefit. |
| **Reasoning / thinking text** | Expensive, and it would push the appraiser into grading the worker's reasoning. The appraisal is about the session's effect on the person — not about the quality of the agent's thoughts. |
| **Another plugin's `custom` entries** | A plugin must not read a peer's private state to make claims about a person. It also couples two repos for no gain; this is why the quick-win integration is prompt-level (PRD §8). |
| **Cost and token-spend totals** | Money pressure is a *different* conversation from cognitive load, and `pi-model-pricing` / `pi-sidebar` already own cost reporting. Making the psychologist a spend meter would turn "how are you doing" into "you cost me X" — the opposite of the intent. |
| **Cross-session history** (reading `~/.pi/agent/sessions/*` directly) | A plugin that profiles a person across sessions without an explicit opt-in is surveillance. Deferred to T10, opt-in, delivery events only. |
| **File contents / code** | T8's mapper reads structure — sizes, counts, layout. Never bodies. |
| **`compaction.details` / `branch_summary.details`** (`{ readFiles, modifiedFiles }`) | The engine's docs call these *"implementation-specific"*. The live observation window already records authoritative mutation paths from tool events, so reading an internal side-channel would add coupling and no signal. |
| **Cache-warming `usage` entries** | Excluded from the cache-read share on purpose: they are an engine optimisation, not turn cost, and including them would inflate the ratio. A test asserts they do not move it. |

---

## 4. What the workshop already does with this data

Read for reference before writing `history.ts`:

| Plugin | Pattern | What is borrowed |
|---|---|---|
| `pi-sidebar/src/stats.ts` | walks entries, sums `usage` across assistant **and** toolResult **and** compaction/branch summaries | the same inclusion set for the cache ratio |
| `pi-mcp-viz` | pairs in-flight tool calls by `toolCallId`, persists totals as a `custom` entry | already independently in our observer slice |
| `pi-herdr-plugin-dev` | session-scoped gate: "have the bundled docs been read *this session*"; per-file line monitor | the session as **memory of what happened**, not just as a transcript |
| `pi-quick-win` | restores its deferred queue from session entries | state that survives `/reload` and `/tree` |
| `pi-at-words`, `pi-anonymizer`, `pi-klid` | read entries for their own scoped purpose | discipline: read only what your own feature needs |

The lesson taken from `pi-herdr-plugin-dev` specifically: the session record is not
a log, it is **session memory**, and a plugin's most useful questions are about what
has *already happened* ("was this read yet?", "has anything been proven yet?").

---

## 5. Engine facts that shaped the implementation

- **Unknown entry types are ignored, never rejected.** The engine's own guidance
  for `usage.kind` is to "treat unknown values as normal usage rather than
  rejecting them"; the fold applies the same rule to entry types, so a future
  engine version adds a type instead of crashing the appraiser. A test pins this.
- **`stopReason` is the only reliable abort signal.** `isError` on a tool result
  means the *tool* failed. A cancelled *turn* is a different field, and conflating
  them would report a user interrupt as an agent failure.
- **`span` scans all timestamps** rather than reading the first and last entry. A
  single malformed timestamp in the tail would otherwise collapse the session span
  to zero and under-report its length — caught by a test, fixed in the code.
- **A burst of user messages must not restart the wait clock.** The wait is
  measured from the first message of a burst to the next assistant reply, so
  queueing more prompts cannot hide a long wait.

---

## 6. Still unused, and worth revisiting

- **Per-tool duration.** Not in the entry record; derivable from the live
  `tool_execution_start`/`_end` pair the observer already sees. Would give "the
  agent took 4 minutes to answer" as a measurable flow-break.
- **Time between the assistant's last message and the next user prompt** — idle
  *after* work rather than between prompts. Currently only prompt-to-prompt gaps
  are counted.
- **`parentSession` lineage** from the header (a `/fork` or `/clone`) — the
  session's own history is `getHeader()`, not `getBranch()`, so the fold does not
  see it. Relevant only if T10 ever lands.