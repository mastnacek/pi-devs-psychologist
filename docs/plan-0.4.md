# Plan 0.4 — pi-pair principles + the agent runtime (`runtime: "agent"`)

**Status:** specification, not implemented. Written 2026-09-28 for an implementer who has
not read the session that produced it. Every task is self-contained: goal, files, behaviour,
acceptance, non-goals, dependencies. No code here on purpose — only what it must do and how.

**Read first, in this order:** `AGENTS.md` (workshop rules), the `pi-plugin-dev` skill
(`SKILL.md` + the reference each task names), `PRD.md` §4–5 (evidence discipline and
prohibitions), `docs/adr/0001-two-roles-one-observer.md`, then this file.

**Engine facts this plan relies on (verified on pi 0.87.1, re-verify after any upgrade):**

| Fact | Where verified |
|---|---|
| CLI: `--model provider/id[:thinking]`, `--thinking`, `--mode json`, `-p`, `--no-session`, `--fork <path>`, `--session-dir <dir>`, `--append-system-prompt <text\|file>` (repeatable), `--tools`, `--exclude-tools`, `-e`, `--skill`, `-a/--approve`, `-nc`, `@file` message args | `pi --help`, `docs/cli.md` |
| `--fork` cannot be combined with `--no-session` | `docs/cli.md:105` |
| JSON mode = JSONL events on stdout: `message_end` (authoritative message, carries `usage`), `tool_execution_start/_end`, `agent_end`, `agent_settled` | `docs/json.md` |
| `ctx.sessionManager.getSessionFile()` / `getSessionId()` / `getSessionDir()` exist on the read-only manager | `dist/core/session-manager.d.ts:178` |
| `pi.on("tool_call")` may return `{ block: true, reason }` | `dist/core/extensions/types.d.ts:887` |
| `pi.registerFlag(name, …)` / `pi.getFlag(name)` exist | `types.d.ts:1028` |
| Engine CLI entry is `dist/bundle/cli.js`; the engine itself reads `process.argv[1]` and `PI_PACKAGE_DIR` | engine `package.json` `bin`, `dist/config.js` |
| Engine docs: `<package root>/docs/*.md` with a navigation index `docs/docs.json`; `README.md`, `CHANGELOG.md` at the root | directory listing |
| `pi-secret-guard`, `pi-quick-win`, `pi-self-compact`, `pi-plugin-dev` **disable themselves** when `PI_SUBAGENT=true` or `PI_CHILD_SESSION` is set | grep of installed packages |
| `nlm` CLI on PATH; skill `nlm-cli-skill` forbids `nlm chat start`, requires `nlm login --check` first | `~/.pi/agent/skills/nlm-cli-skill/SKILL.md` |
| The appraiser already calls the model through an injectable seam `deps.callModel(registry, request) → ModelCallResult` | `src/slices/appraiser/index.ts:151` |
| Failure fingerprints already exist: `FailureFingerprint { toolName, signature, count }` | `src/shared/signals.ts:128` |

---

## 0. Decisions (the implementer does not re-open these)

- **D1 — Two runtimes, one contract.** `runtime: "api"` is today's single completion call.
  `runtime: "agent"` spawns a headless `pi` child with the selected model. Both return the
  same `ModelCallResult` into the same `parseAppraisal` → enforcement → delivery path. The
  appraiser does not know which runtime ran.
- **D2 — Same input, byte for byte.** In agent runtime the child receives *exactly* what the
  API runtime sends today (`SYSTEM_PROMPT` + `buildUserText(...)`) plus a pi-awareness brief
  and, optionally, session context. A test asserts byte identity of the shared part.
- **D3 — Structured output by tool, not by prose.** The child submits its answer by calling
  one tool, `psych_submit`, registered by *this same extension* running in child mode. The
  parent reads the tool arguments from the JSON stream. No parsing of free-form final text.
- **D4 — Read-only child, enforced in code.** The child cannot edit, write, commit, push,
  install or publish. Enforcement is a `tool_call` guard inside the child, not a prompt plea.
- **D5 — Own child marker, never the shared one.** The child gets
  `PI_DEVS_PSYCH_CHILD=1`. It must **not** get `PI_SUBAGENT` / `PI_CHILD_SESSION`: those
  switch off `pi-secret-guard` (security) and other workshop plugins the operator wants
  the child to have.
- **D6 — Session context is a consent level, not a default.** `agent.context` is
  `"evidence"` (default, same data boundary as today) → `"digest"` (bounded, scrubbed
  transcript excerpt) → `"fork"` (the whole session). `digest` and `fork` amend PRD §4.1;
  that amendment is ADR 0002 (task T20) and it is scoped to agent runtime only.
- **D7 — Trigger on evidence, not on the clock** (pi-pair: "audit only what is real"). The
  clock becomes a floor between appraisals, not a reason to run one.
- **D8 — Observer, never gate.** Nothing in this plan blocks the operator or the working
  agent. The commit check (T15) *names* a risk; blocking is `pi-lens --lens-guard`'s job.

---

## Phase A — hygiene (do first, cheap)

### T13 — README truth pass

**Goal:** the README stops contradicting the code.

**Stale claims to fix** (all verified wrong on 0.3.0): "Status `0.2.0` — 169 tests";
key table says `model` is "Chip only until T4" and three keys are "Pending T3/T4" (the
appraiser has shipped — check each key's real consumer with grep and mark it Live or
Pending accordingly); "Today the model is set in the config file; the `/psych` command
below is not built yet (T2–T6)"; `envFacts` key is missing from the JSON example and the
key table.

**Acceptance:** every key in `DEFAULT_CONFIG` appears in the README table with a status
matching a grep for its consumer; version and test count match `package.json` and
`npm test`. Add a test that fails when a `DEFAULT_CONFIG` key is absent from README
(read README as text, assert each key name appears in a table row).

**Non-goals:** rewriting prose that is still true.

---

## Phase B — pi-pair principles on the existing API runtime (zero or lower spend)

### T14 — Signal-triggered appraisal

**Goal:** a healthy stretch costs zero model calls. The model runs when the evidence
contains something *new* worth appraising.

**New file:** `src/shared/triggers.ts` (pure, no I/O).

**Behaviour:**
- Pure function `evaluateTriggers(current, baseline, config) → { fire: boolean, reasons: TriggerReason[] }`.
  `current` = the `SessionSignals` + `SessionHistory` now; `baseline` = a snapshot of the same
  counters taken at the last appraisal attempt (store it in state; empty at session start).
- Triggers are **deltas since baseline**, so the same old failure never fires twice:

| Reason id | Fires when (delta since baseline) | Default threshold |
|---|---|---|
| `failure_streak` | consecutive failed tool calls at the tail of the window | ≥ 3 |
| `recurring_failure` | any `FailureFingerprint.count` grew to ≥ threshold | ≥ 2 |
| `restatement` | new prompts restating an earlier prompt | ≥ 1 |
| `operator_abort` | new `stopReason: "aborted"` turns | ≥ 1 |
| `stale_progress` | `turnsSinceVerifiedProgress` crossed the threshold | ≥ 6 |
| `compaction` | a new compaction entry | ≥ 1 |
| `thinking_raised` | new operator thinking-level raise | ≥ 1 |
| `commit_unverified` | T15 fired | ≥ 1 |
| `delivered` | new verified run after ≥ 4 mutations (a win worth naming — `close_loop`) | ≥ 1 |

- Config: `trigger: "signals" | "cadence"` (default `"signals"`; `"cadence"` = today's
  behaviour, kept for comparison). `cadenceTurns` keeps its name but, under `"signals"`,
  means **minimum turns between attempts** (default lowered from 8 to 3). New
  `triggerThresholds` object with the defaults above; normalisation per key like the
  rest of `config.ts` (junk → default, negative → default).
- The reasons are passed to the model as ONE extra LIVE evidence line:
  `appraisal triggered by: failure_streak, restatement` — citable like any other line
  (it must also be added to `allowedEvidence`).
- `/psych now` (force) bypasses triggers and floor, never the budget (unchanged rule).
- Report and chip: `/psych` shows the last trigger reasons and a counter
  `appraisals skipped: N (no new evidence)` — the measured saving.

**Acceptance (tests):**
- 30 simulated healthy turns (no failures, verified run every 3 turns) → 0 model calls.
- One 3-failure streak at turn 10 → exactly 1 call at the first turn ≥ floor; the same
  streak does not fire again at turn 14 (baseline moved).
- `trigger: "cadence"` reproduces the existing T4 test unchanged.
- The trigger line appears in both the user text and `allowedEvidence`.

**Non-goals:** no model involvement in deciding whether to call the model.

### T15 — Delivery-boundary check (commit without verification)

**Goal:** catch the commonest way an unverified change ships, for 0 tokens.

**Files:** `src/shared/lexicon.ts` (new pattern list `COMMIT_COMMANDS`: `git commit`,
`git push`, `gh pr create`, `npm publish`, `pi update` is NOT one), `src/shared/signals.ts`
(new counter), `src/slices/observer` (records it), `src/slices/interventions` (delivers).

**Behaviour:**
- On a successful `bash` tool whose command matches `COMMIT_COMMANDS`, compute
  `mutationsSinceVerified` = mutation-tool calls since the last verified run.
- If `> 0`: add LIVE evidence line
  `commit after N file change(s) with no verified run since` and deliver a
  **notification** (not a card, not steering) with the same text from `i18n.ts`
  (`en` + `cs`). Also raises trigger `commit_unverified` (T14).
- If `0`: add nothing. Silence is the success path.
- Config `commitCheck: boolean` (default `true`).
- Never blocks, never delays the command (D8).

**Acceptance:** fixture: edit, edit, `git commit` → one notification, one line;
edit, `npm test` ok, `git commit` → nothing; `commitCheck: false` → nothing; a failed
`git commit` → nothing.

### T16 — Intervention outcome ledger (does the plugin help?)

**Goal:** measure the plugin, never the person. Supplies the numbers PRD §9 and the ADR
kill criteria need and currently cannot get.

**Files:** new `src/shared/outcome.ts` (pure), `src/slices/interventions` (records),
`src/slices/report` (shows). Uses `pi.appendEntry` (TUI-only, never in LLM context — see
`references/state-persistence.md`). Coordinate with T7 (same entry mechanism; T7 may
land first or together).

**Behaviour:**
- When an intervention is delivered, store an entry `customType: "psych-outcome"`:
  `{ id, kind, deliveredAtTurn, channel: card|notification|steer, before: Snapshot }`
  where `Snapshot` = `{ failureRate, turnsSinceVerifiedProgress, restatements, aborts }`.
- After `outcomeWindowTurns` (default 5) turns, append a follow-up entry with `after:
  Snapshot` and a verdict per metric: `improved | unchanged | worse` (plain comparison,
  documented thresholds, no weighting, no single score).
- Operator reaction, recorded when observable: `closed_card_ms` (time the card was open),
  `quick_win_called` (the `quick_win` tool ran within the window after `name_next_win`),
  `followed` (next operator prompt shares ≥ 40 % tokens with the intervention text).
- `/psych effect` (new subcommand, terminal leaf, no trailing space): table per kind —
  delivered, improved, unchanged, worse, followed. Session-scoped only (cross-session is
  T10 and stays opt-in).

**Acceptance:** deterministic fixture producing a known before/after; restored after
`/reload` from `getEntries()`; entries never appear in `buildSessionContext` output;
report width-safe.

**Non-goals:** no per-person trend, no streaks, no number about the programmer.

### T17 — Anti-nag cooldown

**Goal:** the same advice is never repeated into a void (pi-pair: "end is end").

**Files:** `src/shared/outcome.ts` (reads the ledger), `src/slices/appraiser` (prompt
line), `src/shared/appraisal-enforce.ts` (post-hoc drop).

**Behaviour:**
- Per kind: `cooldownTurns` (default 6) after delivery.
- A kind delivered twice with `unchanged|worse` outcomes becomes **muted** for the session.
- Before the call: add a LIVE line `do not repeat: <kind> (named N times, no change)` for
  each cooling/muted kind.
- After the call: if the model still picks a cooling/muted kind, drop the intervention,
  keep the verdicts, record `downgraded: "cooldown"` (shown in `/psych`, not on the card).
- `stop` is exempt from cooldown but not from muting.

**Acceptance:** model fake picks `thin_slice` three times with no improvement → delivered
twice, third dropped, line present in the prompt from the second call on.

### T18 — Recurring friction as a first-class signal

**Goal:** turn "the same thing keeps failing" into an accountable object (pi-pair's
"sinking" of semantic findings) and a feed for the scout role (T31).

**Already present:** `FailureFingerprint` in `signals.ts`. **Add:** a LIVE line per
fingerprint with `count ≥ 2`: `recurring failure: <tool> · <signature> ×N` (max 3 lines,
highest count first), trigger `recurring_failure` (T14), and exposure in `/psych`.

**Acceptance:** fixture with 3 identical `bash` failures and 1 different → exactly one
line, `×3`.

---

## Phase C — the agent runtime (the switch)

Order is mandatory: T19 spike → T20 ADR → T21 config → T22 child mode → T23 brief →
T24 runner → T25 schema → T26 async UX → T27 accounting. T28 (digest) and T29 (fork)
are optional context levels after that. T30 (`/psych ask`) any time after T26.

### T19 — Spike: prove the child launch on this machine (no plugin code)

**Goal:** replace every assumption below with an observed fact before building on it.

**Deliverable:** `docs/agent-runtime-spike.md` — one row per question: exact command,
observed output (trimmed), conclusion.

**Questions:**
1. From inside an extension on Windows, does `spawn(process.execPath, [process.argv[1], ...args], { shell: false })`
   start the same pi build? Print `process.argv[1]`. Fallback: `PI_PACKAGE_DIR` +
   `dist/bundle/cli.js`. Never spawn `pi.cmd` through a shell (quoting and injection).
2. `--mode json -p --no-session --model <ref> @<brief-file> "<message>"`: does `@file`
   work in json print mode? (`docs/cli.md:50` only forbids it in RPC.)
3. `--append-system-prompt <path>`: confirm a *path* is read as file contents.
4. `--fork <parentSessionFile> --session-dir <tmpdir>`: does it work while the parent
   session is live and being appended? Does the fork show up in the parent's `/resume`
   (it must not — it lives in `tmpdir`)?
5. Which extensions load in the child? Compare `pi list` with the child's tool list
   (ask it to list tools). Confirm `pi-secret-guard` is active without `PI_CHILD_SESSION`.
6. Tool names available: `web_search` (may need `web_enable` first), `fetch_content`,
   `mcp`, `mcpScript`, `knowledge_base_*`, skills listed in the child's prompt.
7. Project trust in `-p` mode with project `.pi/`: does it prompt/hang? Is `--approve`
   needed, and is it safe to pass only when the parent session is already trusted
   (find how an extension can tell)?
8. Cold-start cost: time from spawn to first `message_start` with all plugins loaded.
   Is `pi-lens`'s session-start scan (knip/jscpd/madge) running in the child? Does
   passing `--no-lens` break when pi-lens is not installed (unknown-flag behaviour)?
9. Does our own extension load in the child when the plugin is installed only in
   project scope, or when the parent runs a dev copy via `-e`? Decide the rule for
   passing `-e <this extension's index.ts>` without creating a duplicate identity
   (AGENTS §4: git vs path identities differ).
10. Killing: does `taskkill /pid <pid> /T /F` remove the whole child tree (pi + its MCP
    servers + LSPs)? POSIX: negative-pid kill of a detached process group.

**Acceptance:** all ten rows filled; any "no" becomes an explicit constraint in T24.

### T20 — ADR 0002: agent runtime and the data boundary

**Goal:** record D1–D6 and amend PRD §4.1 *for agent runtime only*.

**Content:** why a child pi (tools, skills, MCP, research) over a bare completion; the
three context levels as three consent levels; what leaves the machine at each level
(`evidence`: counts + env facts; `digest`: + prompt text and assistant text excerpts,
scrubbed; `fork`: the entire session including tool outputs); the read-only guarantee
and how it is enforced; the D5 marker rationale; kill criterion: *if agent-runtime
interventions are not followed more often than API-runtime ones (T16 `followed`) over
20 deliveries, agent runtime is demoted to `/psych ask` only.*

**Acceptance:** file exists at `docs/adr/0002-agent-runtime.md`; PRD §4.1 links to it
with one sentence; README "Hard rules" gets one line on consent levels.

### T21 — Config, CLI flag and commands for the switch

**Files:** `src/shared/config.ts`, `src/shared/i18n.ts`, `src/slices/commands`,
`index.ts` (flag registration only).

**Config keys (all normalised per key; junk → default):**

| Key | Type / default | Meaning |
|---|---|---|
| `runtime` | `"api" \| "agent"`, `"api"` | The switch |
| `agent.model` | string, `""` | `provider/id[:thinking]`; empty → use `model` |
| `agent.thinking` | `off…max \| ""`, `""` | Passed as `--thinking` when set |
| `agent.context` | `"evidence" \| "digest" \| "fork"`, `"evidence"` | Consent level (D6) |
| `agent.timeoutMs` | number, `180000` | Hard wall-clock cap, then kill |
| `agent.maxToolCalls` | number, `25` | Child-side cap (T22) |
| `agent.maxCostUsd` | number, `0.25` | Per run; `0` = unlimited. Parent kills when exceeded |
| `agent.maxCostUsdPerSession` | number, `2` | Across runs; `0` = unlimited |
| `agent.allowWeb` / `allowMcp` / `allowNlm` | boolean, `true` | Brief + guard honour them |
| `agent.nlmNotebooks` | string[], `[]` | NotebookLM notebook ids the child may query |
| `agent.extraArgs` | string[], `[]` | Appended verbatim to argv (escape hatch, documented as such) |
| `agent.keepTranscript` | boolean, `false` | Keep the child's JSONL in a temp file for debugging |

**Rules:** `runtime: "agent"` with no resolvable model → behaves like `model: ""`
(observation only) and the chip says so. `context: "fork"` is refused (falls back to
`evidence`, with a notification) unless set in config explicitly — never via a one-run
flag, so consent is always a persisted decision.

**CLI flag:** `pi.registerFlag("psych-runtime", string)` → `--psych-runtime agent|api`
overrides `runtime` for this process only, persists nothing.

**Commands (completions per `references/command-completions.md`: non-terminal values
end with a space, terminal leaves do not, the value in effect gets `✓` in `label` and
` · ● ACTIVE` in `description`, every string from `i18n.ts`):**
- `/psych runtime <api|agent>` (terminal leaves)
- `/psych context <evidence|digest|fork>` (terminal leaves; selecting `fork`/`digest` in
  TUI opens `ctx.ui.confirm` stating what will leave the machine; guarded by
  `ctx.mode === "tui"`)
- `/psych agent-model <provider/id>` — reuses the existing registry-driven two-level
  picker (SPAI-011)
- all accept trailing `--global` like the existing setting commands.

**Acceptance:** completion tests with exact `value`/`label` pairs per level; the flag
overrides config and is not written to disk; normalisation tests for each key.

### T22 — Child mode of this extension

**Goal:** when running *as the child*, the same package turns into a sandbox guard plus
a single submission tool (D3, D4).

**Files:** new slice `src/slices/child/index.ts`; `index.ts` branches before the existing
recursion guard: `PI_DEVS_PSYCH_CHILD === "1"` → register only the child slice, return.

**Inputs from env:** `PI_DEVS_PSYCH_RUN` (run id), `PI_DEVS_PSYCH_ROLE`
(`psychologist|pair|scout|ask`), `PI_DEVS_PSYCH_LIMITS` (JSON: `maxToolCalls`,
`allowWeb`, `allowMcp`, `allowNlm`). Malformed → strictest defaults.

**Tool `psych_submit`:** parameters = the role's schema (T25) as TypeBox, `StringEnum`
only (never `Type.Union`/`Literal`). Validates with `Value.Check`; invalid → `throw new
Error(<which field, why>)` so the child model sees `isError` and can retry (max 2 retries
enforced by counting). On success returns `"Submitted. Stop now."` and terminates the run
per the engine's tool-termination contract (`references/tools-and-schema.md`). A second
successful submit is refused.

**`tool_call` guard** returns `{ block: true, reason }` for:
- tools `edit`, `write`, and any tool whose name contains `write|edit|delete|replace|install`
  except `psych_submit`; `ast_grep_replace`; `record_spai_item`; `update_spai_status`;
  `workflow`; `batch_submit_goal`; subagent spawners;
- `bash` commands matching a `CHILD_FORBIDDEN_BASH` lexicon list (new, in
  `lexicon.ts`, readable like the rest): `git (commit|push|reset|checkout|switch|clean|rebase|merge|stash|tag|rm|mv)`,
  `rm `, `rmdir`, `del `, `Remove-Item`, `mv `, `move `, `cp .* > `, output redirection
  `>`/`>>` to a path, `npm (install|i|publish|uninstall)`, `pnpm|yarn|bun (add|install|publish)`,
  `pi (install|remove|uninstall|update|config)`, `gh (repo|pr|issue|release) (create|edit|delete|merge|close)`,
  `nlm (notebook|source|note) (create|delete|add|rename|update)`, `nlm login` (interactive),
  `nlm chat start` (REPL);
- web tools when `allowWeb` false, `mcp`/`mcpScript` when `allowMcp` false, any `nlm`
  when `allowNlm` false;
- **everything except `psych_submit`** once `maxToolCalls` is reached, with reason
  `"tool budget exhausted — call psych_submit now with what you have"`.

Every block reason is English and actionable (it is model-facing).

**Acceptance (tests with a fake `pi`):** each forbidden pattern blocked, `git diff`,
`git log`, `npm test`, `nlm notebook query` allowed; budget exhaustion leaves only
`psych_submit`; invalid submit throws; second submit refused; nothing else from the
parent's slices is registered in child mode (assert registered handler list).

**Known limit to document:** a determined model can still mutate via an unforeseen
bash form. The guard is defence in depth; the brief also forbids it; `pi-secret-guard`
stays active (D5).

### T23 — The agent brief (what the child knows)

**File:** new `src/shared/agent-brief.ts` (pure: inputs in, strings out; resolved paths
passed in, not looked up inside).

**Output:** two strings, written to temp files by the runner:

**(a) `systemAppend`** (passed via `--append-system-prompt <file>`, which *appends* to
pi's own core prompt — never `--system-prompt`, which would erase pi's tool knowledge):

1. **Role prompt.** For `psychologist`: today's `SYSTEM_PROMPT` verbatim, except the
   output paragraph "Answer with ONE JSON object…" is replaced by "Submit your answer by
   calling `psych_submit` exactly once, with the same fields". Keep the replacement in
   one exported constant so the API prompt stays untouched.
2. **Where you are** (fixed English text, values interpolated):
   - "You run inside the pi coding agent, version `<ver>`, started headless by the
     pi-devs-psychologist extension to observe *another* pi session. The operator works
     with pi every day and develops pi plugins in this workspace."
   - "You are an observer. You never change files, never commit, never install. Your
     only output is one `psych_submit` call."
3. **Pi documentation** — absolute docs dir resolved at runtime (T19 Q1), plus this map
   (one line each, path relative to the docs dir): `docs.json` (navigation index — read
   first to find a topic), `extensions.md`, `skills.md`, `packages.md`, `settings.md`,
   `sessions.md`, `session-format.md`, `json.md`, `rpc.md`, `sdk.md`, `tui.md`,
   `keybindings.md`, `models.md`, `providers.md`, `prompt-templates.md`, `security.md`;
   `../README.md`, `../CHANGELOG.md`. Instruction: "read only the file a question needs".
4. **Pi packages** — "Community plugins are listed at https://pi.dev/packages. Search:
   `https://pi.dev/packages?name=<term>` (fetch with `fetch_content`). A package page is
   `https://pi.dev/packages/<name>` and shows its manifest, install command and README.
   Install specs look like `npm:<name>` or `git:github.com/<owner>/<repo>`. Run `pi list`
   first so you never propose something already installed. Packages execute code: you
   may *propose* one with its source link; you never install it."
5. **Tools you may use** (each bullet only when allowed by limits):
   - web: "If `web_search` is not in your tool list, call `web_enable` first. Prefer
     `queries` with 2–3 angles. Cite URLs."
   - MCP: "`mcp({})` lists connected servers; `mcp({ search })` finds tools. Use
     `mcpScript` only when chaining several calls."
   - skills: "Your prompt lists available skills. Load one with `read` on its path only
     when the task matches."
   - NotebookLM: "Run `nlm login --check`; if it fails, skip NotebookLM entirely (never run
     `nlm login`). Query with `nlm notebook query <id> \"<question>\"`. Allowed notebooks:
     <ids from config with optional titles>. Never `nlm chat start`. Keep output small
     (no `--json` dumps into context)."
   - repo: "`read`, `grep`/`find`/`ls`, `git diff`, `git log`, `git show` are fine."
6. **Budget:** "At most `<maxToolCalls>` tool calls. Spend them only if they change your
   answer. Zero tool calls is a correct outcome when the evidence already decides."
7. **Research rule:** "Evidence lines are the only basis for verdicts and the
   intervention. Research you do may only fill `suggestions`, and every suggestion needs
   a `source` (URL, docs path, `nlm:<id>`, or package spec)."

**(b) `userMessage`** = exactly `buildUserText(liveLines, sessionLines)` (D2), plus, when
`context` is `digest`, a trailing block from T28; the final instruction line becomes
"Appraise the session now. Submit with psych_submit."

**Acceptance:** snapshot test of both strings for a fixture; test that the evidence part
of `userMessage` is byte-identical to the API runtime's `buildUserText` output; test that
disabled capabilities (`allowWeb:false` etc.) remove their bullet; no absolute home path
of the operator appears except the docs dir.

### T24 — The runner (spawn, stream, limits, kill)

**File:** new `src/shared/agent-runner.ts`. Two parts: a **pure argv/env builder**
(fully unit-tested) and a thin **process wrapper** (tested with a fake child process).

**Signature:** exposes a function with the same shape as `callModel` —
`(registry, request, agentOptions) → Promise<ModelCallResult>` — so the appraiser's
`deps.callModel` is swapped by runtime in the composition root, nothing else changes (D1).
Extend `ModelCallStage` with `"spawn" | "timeout" | "budget" | "no_submission" | "exit"`.

**Argv (order fixed, one array, `shell: false`):**
`[cliPath, "--mode", "json", "-p", <"--no-session" | "--fork", sessionFile, "--session-dir", tmpDir>,
"--model", ref, ("--thinking", level)?, "--append-system-prompt", briefFile,
("--approve")? per T19 Q7, ...extraArgs, "@" + messageFile]` — never pass prompt text on
the command line (Windows 32 KB limit, quoting).

**Env:** copy of `process.env` + `PI_DEVS_PSYCH_CHILD=1`, `PI_DEVS_PSYCH_RUN`,
`PI_DEVS_PSYCH_ROLE`, `PI_DEVS_PSYCH_LIMITS`. **Delete** `PI_SUBAGENT` and
`PI_CHILD_SESSION` if present (D5). `cwd` = parent `ctx.cwd`.

**Temp files:** one directory per run under `os.tmpdir()/pi-devs-psychologist/<runId>/`;
removed in `finally` unless `keepTranscript`. Files: `brief.md`, `message.md`,
`events.jsonl` (only when `keepTranscript`), `session/` (fork mode).

**Stream handling:** split stdout by `\n`, `JSON.parse` each line, ignore non-JSON.
- `tool_execution_start` with `toolName === "psych_submit"` → capture `args`.
- `tool_execution_end` for it with success → mark submitted.
- `message_end` with `role: "assistant"` → add `usage` (tokens + cost) to a running total;
  if `maxCostUsd > 0` and total exceeds it → kill, stage `"budget"`, return usage.
- Count `tool_execution_start` by name (for T27).
- `agent_settled` or process exit → finish.
- stderr: keep the last 8 KB for the error message; never the whole stream.

**Result:** submitted → `{ ok: true, text: JSON.stringify(args), provider, modelId, label,
usage }` so the existing `parseAppraisal` runs unchanged. Not submitted → `{ ok: false,
stage: "no_submission", error: "<last assistant text, 300 chars>" }`.

**Limits & kill:** `setTimeout(timeoutMs)` → kill tree (Windows `taskkill /pid <pid> /T /F`,
POSIX `process.kill(-pid)` with `detached: true`), stage `"timeout"`. The parent's
`ctx.signal` abort and `session_shutdown` also kill. Kill is idempotent.

**Acceptance:** argv snapshot per context level; env assertions (marker set, shared
markers removed); fake child emitting a scripted JSONL stream → success, no-submission,
over-budget, timeout, garbage lines, non-zero exit; temp dir removed in every path.

### T25 — Schema: `suggestions` for researched output

**Files:** `src/shared/appraisal.ts`, `src/shared/appraisal-enforce.ts`,
`src/slices/overlay/layout.ts`, `i18n.ts`.

**Schema addition (both runtimes accept it; API runtime simply never gets tools to fill
it):** `suggestions`: array, `maxItems: 3`, each `{ kind: StringEnum(["package","skill",
"doc","research","workflow"]), text: string (≤ 200 chars), source: string, cited: string[] (≤ 2, optional) }`.

**Enforcement:** `source` must match one of: `https://…`; a path inside the resolved pi
docs dir; `nlm:<notebookId>` where the id is in `agent.nlmNotebooks`; `npm:<name>` or
`git:github.com/<owner>/<repo>`. Anything else → suggestion dropped, counted in
`unmatched`. `cited` lines, when present, must match evidence verbatim like verdicts.
Verdicts and the intervention keep today's rules untouched.

**Delivery:** suggestions go to the operator only — card section "Researched
suggestions" with the source on its own dim line (width-safe via `truncateToWidth`),
notification fallback lists at most one. **Never** sent to the working agent, even with
`steerAgent: true`.

**Acceptance:** enforcement tests for each source form and each rejection; card render
test at width 40 and 120 with no line over width; steering test proves suggestions never
reach `sendMessage`.

### T26 — Async delivery and UX for slow runs

**Goal:** an agent run takes tens of seconds to minutes; the operator must never wait on it.

**Behaviour:**
- `turn_end` starts the run and returns immediately (promise tracked in state,
  single-flight unchanged).
- Chip while running: `psych: researching 42s · 7 tools` (from `i18n.ts`, updated at most
  once per second via `setStatus`).
- `/psych stop` (terminal leaf) kills the run.
- **Deliver at a natural pause** (new, also for API runtime): if the agent is streaming
  when the result arrives, hold it; present on the next `agent_end`. If the operator is
  idle, present immediately.
- If ≥ 3 turns passed since the run started, the card header adds
  `based on the session N turns ago`.

**Acceptance:** fake runner resolving mid-stream → card appears only after the simulated
`agent_end`; `/psych stop` kills and records stage `"aborted"`; chip text snapshot.

### T27 — Accounting in `/psych`

**Behaviour:** the report gains a "Last run" block: runtime, model, context level,
duration, tool calls by name (top 5), tokens in/out, cost, outcome stage; and a session
line: runs, total cost vs `maxCostUsdPerSession`. Budget refusal when the session cost cap
is reached, reason `"cost"` (new `AppraiseOutcome` reason).

**Acceptance:** report snapshot from a recorded fake run; cap reached → next run refused.

### T28 — Context level `digest` (optional)

**File:** new `src/shared/digest.ts` (pure over `getBranch()` entries).

**Content:** last 12 operator prompts (≤ 500 chars each), assistant **text** blocks
(≤ 300 chars each; never thinking), tool calls as `tool(path) ok|fail` — **never tool
outputs**; total ≤ 6000 chars, oldest dropped first. Scrubber applied last: redact
`sk-…`, `ghp_…`, `github_pat_…`, `AKIA…`, `xox[bp]-…`, `Bearer …`, `-----BEGIN … KEY-----`
blocks, and `KEY=value` where the key contains `KEY|TOKEN|SECRET|PASSWORD`.

**Acceptance:** fixture with each secret form → all redacted; cap respected; no
`toolResult` content ever present (assert by planting a marker string in a tool output).

### T29 — Context level `fork` (optional)

**Behaviour:** argv uses `--fork <getSessionFile()> --session-dir <runTmp>/session`
(T19 Q4 must be green). First use per session in TUI: `ctx.ui.confirm` showing the
latest assistant `usage.input` as the estimated context size and its price at the child
model's rate from the registry. Headless → refuse. No session file (ephemeral parent) →
fall back to `digest`, notify.

**Acceptance:** argv snapshot; ephemeral parent falls back; tmp session dir removed.

### T30 — `/psych ask <question>`

**Goal:** the operator consults the observer directly. The most direct value of agent
runtime: "why am I stuck?", "is there a plugin for this?", "what does the research say
about this pattern?"

**Behaviour:** always agent runtime (falls back to API with no tools if runtime is `api`
and says so). Role `ask`: same brief, evidence and limits; schema = `{ answer: string
(≤ 800 chars), cited: string[], suggestions }`; the answer must cite evidence lines or
suggestion sources. Consumes one budget unit. Result shown as a card.

**Acceptance:** command registered with a non-terminal `ask ` completion; fake runner
answer rendered; budget decremented; uncited answer is shown with an "unsupported"
marker, not hidden.

---

## Phase D — roles on the shared runner

### T31 — Scout role (new): friction → existing plugin or a new one

**Goal:** workshop leverage. When friction recurs, find out whether the ecosystem already
solves it before anyone builds anything (AGENTS "not already solved" rule, automated).

**Trigger:** T18 `recurring_failure` with `count ≥ 3`, or `/psych scout <topic>`.
Own consent gate: `roles.scout.enabled` (default `false`), agent runtime only.

**Brief additions:** search `https://pi.dev/packages?name=<terms>`, npm, GitHub; check
`pi list`; check the local workshop (`D:\01_programovani\pi\plugins` is the operator's
monorepo — read the plugin READMEs there, never edit).

**Output schema:** ≤ 3 candidates `{ name, installSpec, url, why (≤ 160 chars), fit:
StringEnum(["solves","partial","inspiration"]) }` or `{ build: { title, oneLine } }`
with a ready SPAI line (`? <text> @<project> :tag:`) the operator can paste.

**Acceptance:** fake run → card with candidates; `fit` enforced; `installSpec` must match
the T25 package source forms.

### T32 — Pair role (revises T12)

**Before building:** install `npm:pi-pair` in a scratch session and compare (fresh-spawn
forked auditor, decision chain, commit gate). Record the comparison in
`docs/inspiration.md`. Add `pi-pair` to ADR 0001's kill criterion ("if it duplicates
pi-lens, pi-architecture-watcher **or pi-pair**, do not ship").

**What changes if it still ships:** agent runtime removes most of T12a/T12c — the child
reads `git diff` and files itself, so the parent never retains change content in memory
(the ADR 0001 liability disappears). Trigger = T15 delivery boundary (commit) or a
labelled checkpoint. Its only distinct value vs pi-pair: a *different, stronger model*
than the worker, plus convention checking against `AGENTS.md`. Invariants of ADR 0001
unchanged (proposes only, abstention first-class, cite a stated rule).

### T33 — NotebookLM research grounding (setup + wiring)

**Goal:** the psychologist grounds its intervention choice in the literature it claims,
instead of reciting it.

**Steps:** (1) create a notebook "pi-devs-psychologist — developer psychology" with the
sources behind `docs/research-notes.md` §1–9 (Amabile & Kramer — Progress Principle;
Deci & Ryan — SDT; Schultz — reward prediction error; goal gradient + Zeigarnik; Deci,
Koestner & Ryan 1999 — overjustification; Noda, Storey, Forsgren & Greiler — DevEx; the
AI-specific findings of §7) using the `nlm-cli-skill` workflow; (2) put its id in `agent.nlmNotebooks`; (3) the brief
already allows `nlm notebook query`; (4) document the setup in README.

**Acceptance:** `nlm notebook query <id> "What does the progress principle say about
small wins?"` returns an answer; a fake-run test shows a `research` suggestion with
`source: "nlm:<id>"` accepted by enforcement.

---

## Ideas not yet tasks (ranked by expected value per cost)

1. **Replay harness — `/psych replay <session-file>`.** Fold signals + history from any
   past session file and run the appraisal offline. Builds an eval set from real sessions
   (expected intervention kind per window) and lets prompt changes be measured instead of
   argued. Run many windows through the OpenRouter Batch API at 50 % price.
2. **Handoff at `session_shutdown`, zero tokens.** One factual ledger of open loops:
   unverified mutations, bookmarks still set, last failing fingerprint. Offered as a
   ready-to-paste SPAI line; never written automatically.
3. **Same-model warning in code.** README tells the operator to pick a model the worker
   is not; enforce it: when `ctx.model` equals the resolved observer model, the chip and
   `/psych` say so.
4. **Cost preview in the model picker.** Show an estimated cost per appraisal (prompt
   tokens × registry price) next to each model in `/psych model`.
5. **Session-start line from the ledger (needs T10 opt-in).** "Last session ended with 5
   unverified changes in `layout.ts`" — the cheapest possible re-entry help.
6. **Flow shield.** When `protect_flow` is the active intervention, hold every *other*
   plugin-owned notification of this plugin until the next `agent_end` — the plugin
   practises what it preaches.

---

## Suggested delivery slices (each one shippable, tested, pushed on its own)

| Release | Tasks | Value in one line |
|---|---|---|
| 0.3.1 | T13 | README stops lying about three keys and the version |
| 0.4.0 | T14, T15, T18 | Fewer model calls on healthy stretches; unverified commits named for 0 tokens |
| 0.4.1 | T16, T17 | The plugin can prove it helps, and stops repeating itself |
| 0.5.0 | T19–T27 | The switch: the observer becomes a read-only pi agent with web, MCP, skills, docs, NotebookLM |
| 0.5.x | T28, T29, T30 | Deeper context by consent; direct questions |
| 0.6.0 | T31, T33, then T32 | Scout finds existing plugins; research-grounded advice; pair only if pi-pair leaves a gap |
