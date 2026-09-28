# ADR 0002 — The agent runtime and the data boundary

**Status:** accepted as design; implementation is T21–T27 (only config, report, chip and the
switch ship in T21 — nothing spawns yet)
**Date:** 2026-09-28
**Supersedes:** nothing. **Amends:** PRD §4.1, scoped to `runtime: "agent"` only. The default
API runtime keeps PRD §4.1 exactly as written.

---

## Context

PRD §4.1 sets one data boundary: the appraiser receives the evidence lines — *counts and
names* — plus a bounded tail of the conversation, and **nothing else**. A psychological
reading of a session is not a licence to read the session.

The 0.4 plan adds a second way to form the appraisal: instead of one completion call
(`runtime: "api"`), spawn a headless **child `pi`** (`runtime: "agent"`) that has tools,
skills, MCP servers and the pi documentation, and that submits its answer by calling one
tool. That child can do what a bare completion cannot — read the local plugin workshop, fetch
a package page, query NotebookLM, check `pi list` — but it also *runs inside the operator's
machine*, which is a materially different thing from a stateless API call.

Before building on that, the launch facts were checked rather than assumed (T19,
`docs/agent-runtime-spike.md`, pi 0.87.1). Two of them shape this decision: on this machine
`pi-secret-guard` is filtered off globally, so the child has **no** peer secret guard to rely
on; and every globally installed, unfiltered plugin (pi-lens, SPAI, workflow, web-access, MCP)
*does* load in the child. The read-only guarantee therefore has to be our own code, and the
consent boundary has to be ours to draw.

---

## Decision

### 1. Why a child `pi`, not a bare completion

The observer's job, when it is worth more than arithmetic, is to *look something up*: "is
there a plugin for this?", "what do the docs say about `--fork`?", "does the literature
support this intervention?". A completion call cannot read a file, list installed packages or
fetch a page. A child pi can, using the tools the operator already trusts, and it returns one
structured answer through a tool call — so the parent reads JSON, not prose, and the existing
`parseAppraisal` → enforcement → delivery path is unchanged.

Both runtimes return the same `ModelCallResult` into the same path (**D1**). The appraiser
never learns which runtime ran. The child receives *byte-for-byte* the same
`SYSTEM_PROMPT` + `buildUserText(...)` the API runtime sends (**D2**), plus a pi-awareness
brief and, optionally, session context.

### 2. Three context levels are three consent levels

`agent.context` is not a quality knob; it is the operator's answer to "what may leave the
machine". Each level strictly contains the one before it, and each is a separate decision:

| `agent.context` | What leaves the machine | Consent |
|---|---|---|
| `evidence` (default) | The evidence lines only: counts, names, env facts. **Identical to the API runtime today** | Implied by choosing a model at all |
| `digest` | Evidence **+** a bounded, scrubbed transcript excerpt: last N operator prompts and assistant *text* (never thinking, never tool outputs) | Explicit and persisted |
| `fork` | Evidence **+** the entire session, tool outputs included, forked into the child as its starting context | Explicit and persisted |

Two rules make the levels load-bearing:

- **A one-run flag never carries consent.** `--psych-runtime agent|api` overrides the runtime
  for one process and is never written to disk; there is deliberately **no** flag for
  `context`. `digest` and `fork` are only ever set as a persisted config decision, so consent
  is always something the operator chose for the future, not something a shell history
  happened to contain.
- **The wider levels are chosen in the terminal, with the consequence stated.** Selecting
  `digest` or `fork` opens a confirm that names what will leave the machine. Outside a TUI
  (`json`, `print`, RPC) there is nobody to confirm, so the command refuses and says to edit
  the config file — a headless run must never silently widen the boundary.

### 3. The read-only guarantee, and how it is enforced

**The child cannot edit, write, commit, push, install or publish.** This is a *code* guarantee,
not a prompt plea (D4):

- A `tool_call` guard inside **this same extension running in child mode** returns
  `{ block: true, reason }` for every mutating tool — `edit`, `write`, `ast_grep_replace`,
  `workflow`, `batch_submit_goal`, `record_spai_item`, `update_spai_status`, subagent
  spawners, and any tool whose name contains `write|edit|delete|replace|install`.
- `bash` commands matching a forbidden lexicon (`git commit|push|reset|…`, `rm`, `Remove-Item`,
  output redirection, `npm install|publish`, `gh … create|delete|merge`, `nlm … create|delete`,
  `nlm login`, `nlm chat start`) are blocked with an English, actionable reason.
- Web, MCP and NotebookLM tools are blocked when `allowWeb`/`allowMcp`/`allowNlm` are false.
- Once `maxToolCalls` is reached, everything except `psych_submit` is blocked.

**It does not assume any peer plugin.** The spike found `pi-secret-guard` filtered off on this
machine, so the guard does not lean on it. This is defence in depth with a known ceiling: a
determined model could still mutate through an unforeseen `bash` form, which is why the brief
**also** forbids mutation and why the guard is one layer, not the only one. The honest statement
of the guarantee is: *the read-only child is enforced by our own guard, which blocks the known
mutating surface, and the brief forbids the rest.*

### 4. The child marker (D5)

The child receives `PI_DEVS_PSYCH_CHILD=1`, read by this extension to switch into child mode. It
must **not** receive `PI_SUBAGENT` or `PI_CHILD_SESSION`: those are the workshop's shared
"subagent" markers, and plugins that honour them — `pi-secret-guard` (security), `pi-lens`,
`pi-quick-win`, `pi-self-compact`, `pi-plugin-dev` — switch *themselves off*. The operator wants
the child to have pi-lens and friends, so the child gets a **private** marker and those two
are deleted from its environment. The marker exists so that this plugin's own two roles cannot
be confused, not to hide the child from every other plugin.

### 5. Kill criterion

**If agent-runtime interventions are not followed more often than API-runtime ones over 20
deliveries, the agent runtime is demoted to `/psych ask` only.** The measurement already
exists: T16's outcome ledger records `followed` per delivery, and `/psych effect` shows it
per kind. "More capable" is a hypothesis; the ledger decides it, or the child pi is not worth
the process spawn, the temp files and the wider surface.

---

## Consequences

**Positive:** the observer can research an intervention instead of reciting it; the answer
arrives as structured JSON through one tool, so enforcement is unchanged; the boundary is drawn
in one place (`agent.context`) and stated to the operator at the moment it widens.

**Negative, and accepted:** a child pi is a real process with real tools and a ~6 s cold start
(spike Q8); `fork` sends the whole session, tool outputs included, which is a genuine widening
of what leaves the machine; the read-only guard has a known ceiling and is not a sandbox.

**Risk:** the child becomes an expensive, slow path used on healthy stretches. Mitigated by the
signal trigger (D7), the per-run and per-session cost caps, and the kill criterion above.

---

## What would prove this decision wrong (check when built)

- **The kill criterion above:** agent-runtime advice is not followed more than API-runtime
  advice. Then the child is a cost with no measured benefit.
- **The child cannot be kept read-only** without a sandbox we do not have: if the guard is
  routinely bypassed in testing, the runtime should not ship with tools at all.
- **`fork`/`digest` are never chosen** and `evidence` always suffices: then the wider consent
  levels are surface without a user, and should be removed rather than kept "just in case".
