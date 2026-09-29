# pi-pair vs. pi-devs-psychologist pair role — static source comparison

**Subject:** npm package `pi-pair@1.0.77`, author Nuctori, MIT.
**Integrity:** `sha512-7ZBKGS2rvcC0wj5F/A9Dj/Npn6lY2dJXaEHShZZvhYLv7HzXYus1TAuJgse9AqezHeoWKegLdm2aw8Vp0SUfGg==`
**Tarball sha256:** `ed904a192dabbdc0b4c23e45fc0f438ff3699fa958d9d2576841d285966f8582efec7cd762eb354c`
**Published:** 2026-08-15. Repository `git+https://github.com/Nuctori/pi-pair.git` (`package.json`).
**Date of this review:** 2026-09-29.

File inventory read: `extensions/decision-chain.ts` (2182 lines),
`lib/chain-store.ts` (2006), `agents/decision-auditor.md` (185),
`skills/decision-chain/SKILL.md` (85), `prompts/pair-audit.md` (18),
`test/chain-store.test.ts` (2760), `README.md`, `package.json`.

---

## Method

- Read-only. The package was already extracted at
  `C:/Users/jaroslav/AppData/Local/Temp/tmp.nEjbmJAZak/package`; nothing was installed,
  registered, or executed.
- Read source directly (`read`, `grep`) on the extracted tree; no `npm install`, no `pi install`,
  no `-e` load, no process spawn. All findings are static (code + README), not runtime observations.
- "pi-pair" line references are relative to that extracted tree; "ours" references are relative to
  this repo (`D:/01_programovani/pi/plugins/pi-devs-psychologist`).

---

## 1. Trigger mechanics

**Events hooked** (`extensions/decision-chain.ts`):

| Event | Line | Use |
|---|---|---|
| `session_start` | 751 | clear cwd-keyed memory state; reset decision signal |
| `session_shutdown` | 803 | stop orphan runs / timers |
| `before_agent_start` | 1249 | inject prior signature/interim findings into context (deduped) |
| `agent_end` | 1457 | **the trigger and the delivery gate** |
| `message_start` | 2126 | user message releases the gate wait |
| `message_end` | 2154 | append user + assistant text to convlog; process log |

**What gates a spawn.** In `agent_end` (1457) the extension computes:

- `hasNewCommit = head !== null && gatedHead.get(root) !== head` (1476) — a change of **git HEAD**
  since the last gated HEAD. `gatedHead` is the persisted baseline (state key `gatedHead`,
  `lib/chain-store.ts:872`).
- `hasUncommittedChanges(root)` (1560) — any dirty working tree.
- `decisionThisRound` (1558) — set only when the main agent called the `decision_add` tool this
  round (`roundDecisionMade`, tool at 886).
- `hasWork = hasUncommittedChanges || hasNewCommit || signature.status === "failed" ||
  (hasNewConversation(...) && decisionThisRound)` (1558–1564).

So the gate is **objective git artifacts**: uncommitted diff, or a new commit, or a prior failed
spawn, or (only if `decision_add` was called) new conversation. A pure chat round spawns nothing
(comment 1559–1560, "零 spawn"). There is **no keyword/model-based "done" detection** by design
(1462–1464).

**Blocking or background?** Normal rounds are async: `agent_end` spawns and returns ("常规轮 →
异步 spawn，不阻塞", 1820–1822). The **delivery gate** is a `setInterval` background poll at
2000 ms (`gatePollTimers`, 1921) with `GATE_TIMEOUT_MS = 300_000` (339); `agent_end` does not
block — the user can keep typing, and a user `message_start` releases the wait (2126–2150). On
timeout it degrades to `passed-with-warning` and releases (1893–1918). `MAX_BLOCKED_STREAK = 3`
(337) force-releases a repeatedly failing artifact (1845–1853).

---

## 2. Spawn mechanics

- **API:** not the pi extension API directly, and not a child process. It talks to the
  **`pi-subagents` RPC bus** over `pi.events` (`RPC_READY = "subagents:rpc:v1:ready"`,
  `RPC_REQUEST`, `RPC_REPLY_PREFIX`; 37–63). `makeRpc` sends method `"spawn"` (1668). README
  states the dependency outright: "Requires **pi-subagents** (spawns the auditor)" (README:55,
  131).
- **Agent file:** `agent: AUDITOR_AGENT`, `const AUDITOR_AGENT = "pi-pair.decision-auditor"`
  (184) → `agents/decision-auditor.md`, declared in `package.json` under both `"pi".subagents`
  and `"pi-subagents"`.
- **Context:** the automatic `agent_end` spawn uses **`context: "fork"`** (1673) — *it inherits the
  whole session context.* The L2 delivery reviewer and the manual `/pair-audit` command use
  **`context: "fresh"`** (441–446; 1163–1168).
- **Async:** `async: true` (1672) — fire-and-forget, result returns via `async-complete`
  events, not awaited.
- **Model:** `AUDITOR_MODEL = process.env.PI_PAIR_AUDITOR_MODEL?.trim() || undefined` (190);
  passing `model` in the spawn params only if set (1674). **Unset = inherit the main session
  model** (README:215). Cross-model comparison is explicitly rejected (README:242).
- **Env vars:** `PI_PAIR_AUDITOR_MODEL` (190, 215), `PI_PAIR_CHAIN_PUBLIC` (chain-store 41),
  `PI_PAIR_PROCESS_LOG` (2160), `PI_PAIR_PROJECT_ROOT` (chain-store 78), `PI_PAIR_LANG` (494).
- **Cost:** yes — for the automatic audit it **forks the whole session** into the child
  (1673 + agent frontmatter `defaultContext: fresh`, but the spawn call overrides to `fork`).
  Every round that produces a commit/dirty diff or a `decision_add` call pays a full-fork child
  run plus, on delivery, a second `context:"fresh"` L2 reviewer (402, 441). The `context:"fork"`
  spawn is the single largest cost line.

---

## 3. Data it writes

All under the resolved project root (`resolveProjectRoot`, chain-store 74–78), default private
`.pi/decision-auditor/`.

| Path | Code | Holds |
|---|---|---|
| `.pi/decision-auditor/chain.md` (or `docs/decisions/chain.md` if `PI_PAIR_CHAIN_PUBLIC=1`) | chain-store 37–49 | append-only decisions `## D-NNN` with Context/Decision/Rationale/Alternatives/Confidence/Supersedes |
| `.pi/decision-auditor/state.json` | chain-store 899 | audit state: `lastAuditedId`, `convExtractedLine`, `signature{status,at,blockers,runId,head,reason}`, `signatureConvLine`, `blockedStreak`, `auditFindings[]`, `auditRunId`, `gatedHead`, `inFlight`, `injected*At` (848–892) |
| `.pi/decision-auditor/audit-log.md` | chain-store 54 | `AUDIT-<epoch>` proof entries + generalization section (report-before-signature) |
| `.pi/decision-auditor/convlog.md` | chain-store 1701 | **user prompts + assistant final text**, one line each, clipped to 800 chars (1709–1730) |
| `.pi/decision-auditor/process.md` | chain-store 1820 | assistant replies that match a decision-signal regex, ≤200 chars (1805–1860) |
| `.pi/decision-auditor/gaps.md` | chain-store 700 | generalization findings, one line `场景|路径|来源` |
| `.pi/decision-auditor/latest-audit.md` | chain-store 905 | cross-session report dump (written from `before_agent_start`, 1330–1360) |

**Does it record conversation bodies?** Yes. `message_end` (2154–2178) writes **both** user
prompts and assistant final text into `convlog.md` via `appendConv` (chain-store 1709):
`## 👤 用户: <text clipped 800>` / `## 🤖 助手: <text clipped 800>` (1726–1727). It excludes
tool calls, code, and thinking (header, 1691–1698), but the user's own prompt text **is written
to disk verbatim up to 800 chars**, every turn, in the project tree. It is a plain `.md` in
`.pi/`, not encrypted, and (in public mode) goes to `docs/decisions/` inside git. This is the
sharpest privacy difference from our plugin, whose `evidence` level sends counts and names only.

---

## 4. The auditor contract (`agents/decision-auditor.md`, 185 lines)

- **Frontmatter (1–9):** tools `read, write, grep, find, ls, bash, contact_supervisor`;
  `systemPromptMode: replace`; `defaultContext: fresh`; `inheritProjectContext: false`;
  `inheritSkills: false`; `acceptanceRole: writer`. It may write **only** chain.md / audit-log.md /
  state.json.
- **Two duties (13):** *capture* (extract decisions from convlog into the chain — the main agent
  cannot be trusted to self-record) and *audit* (review the reasoning chain).
- **Lifecycle (15–23):** fresh spawn each run; "signature = delivery"; stopped immediately after
  signing. Interim findings must be written with `inFlight=true` so a SIGINT kill still delivers
  partial results.
- **Capture (step 0, 43–56):** read convlog increment from `convExtractedLine`, append `D-NNN`
  via `decision_add`; append-only, no full rewrite (explicit 50 KB rule, 56); extract subagent
  decisions only through the main agent's restatement (53).
- **Goal derivation (step 1, 58–63):** derive the goal from **user prompts in convlog**; the main
  agent's self-description is untrusted ("主 agent 自述不可信").
- **Independent verification (step 0.7, 67–75):** verify every Context fact in the repo with
  read/grep/find/read-only bash; a fact that contradicts the repo = "偏离 ✗".
- **Adversarial protocol (77–97):** artifacts are "guilty until proven innocent" — actively try to
  refute. Five elegance dimensions: **Atomicity, Correctness, Consistency, Cohesion,
  Completeness**; plus chain-consistency checks (dangling Supersedes, transitive, unverified
  assumptions).
- **Two empirical blind-spot dimensions (99–105):** *mechanism integrity* (every trigger chain
  link has a live, reachable call site — not dead code) and *runtime behavior vs claim* (blocking /
  async claims must hold across TUI/print/RPC, else the difference must be flagged).
- **Divergent verification (107–118):** hunt undeclared assumptions, ignored alternatives, edge
  counterexamples, cross-layer blind spots, second-order effects, cross-domain failure patterns.
- **Verdict (120):** any concrete defect in any dimension → `blocked` with actionable blockers;
  all five unrefuted → `passed`.
- **Signoff (154–180):** write the report to audit-log first, then `signature` with `at` (epoch ms),
  `head` (`git rev-parse HEAD`, full hash), `runId`; `blocked` requires a **non-empty** `blockers`
  array. `passed-with-warning` is the extension's escalation, not the auditor's answer.
- **Generalization findings (142–150):** divergent paths that do not map back to a defect are sunk
  into `gaps.md` as `- 场景: X | 路径: Y | 来源: Z`; the last 10 are re-scanned each round;
  recurrent patterns are flagged for distillation into an audit dimension.

---

## 5. Guardrails

- **Never blocks a tool call.** `grep` over the extension finds **no** `pi.on("tool_call")` and no
  `block: true` anywhere (only `registerTool` at 886/952/988/1024, which *add* tools). pi-pair has
  no `tool_call` interceptor; it cannot stop or veto the working agent's actions.
- **It does not mutate files in the working tree by itself** — all writes are the auditor's, into
  chain.md / audit-log.md / state.json (agent md 179). The extension writes only state/chain/log
  files. It has no `edit`/`write` of source code.
- **It does write into the working agent's context.** `before_agent_start` (1249) injects
  `valueMsgs` — the prior blocked/warning blockers and interim findings — as visible user-role
  content (1289–1310), and `async-complete` calls `pi.sendUserMessage(..., { deliverAs:
  "followUp" })` (2069–2076). So pi-pair's findings **do enter the working agent's context**
  (the opposite of our `steerAgent: false` default). Cross-session findings are instead written
  to `latest-audit.md` with a notify (1330–1360) to avoid leaking into an unrelated new session.
- **When the user sees something:** (a) a TUI **notify** on commit-gate wait (1849–1855) and on
  spawn failure / timeout / multi-instance skip (1494, 1785, 1201); (b) the injected blocker text
  on `before_agent_start` / `sendUserMessage`; (c) the footer "breathing light" while an auditor
  runs (491–563). Otherwise normal rounds are silent to the user; the audit is a background task
  with a completion notification.

---

## 6. Overlap matrix (our mechanisms vs. pi-pair)

| Our mechanism (evidence) | pi-pair | pi-pair evidence |
|---|---|---|
| **Signal fold → evidence lines** (`src/shared/signals.ts`, line text built in `src/shared/signals-evidence.ts:52`) | **Not covered** | pi-pair has no signal fold and no evidence-line vocabulary; it audits prose decisions, not session counters. Its process log is a regex over assistant text (chain-store 1805). |
| **Trigger reasons** (`src/shared/triggers.ts:104–188`, 9 reasons incl. `commit_unverified`) | **Partially** | pi-pair triggers only on git HEAD change / dirty tree / `decision_add` call (`decision-chain.ts:1558–1564`). No failure-streak, restatement, abort, compaction, stale-progress, thinking-raise reasons. |
| **Commit-unverified check** (`src/shared/lexicon.ts:45–56` COMMIT_COMMANDS; `signals.ts:243–259`; notification T15 plan 133–155) | **Partially (different shape)** | pi-pair's delivery gate *is* commit-based (`hasNewCommit`, 1476) but it gates a **whole-session fork audit**, not a 0-token notification naming "N file changes with no verified run". It never computes mutations-since-verified and never emits our evidence line. |
| **Outcome ledger** (`src/shared/outcome.ts`, T16 plan 156–185) | **Not covered** | No before/after verdict, no `improved/unchanged/worse`, no `followed` metric anywhere in the package. README Roadmap lists "Benefit measurement" as **unbuilt**: "recall/false-positive stats make precision gain quantitative" (README:249). |
| **Cooldown / muting** (`outcome.ts`, T17 plan 186–200) | **Not covered** | No cooldown or mute concept. pi-pair's cadence control is spawn gating, not repeat suppression. |
| **Agent runtime + read-only child guard** (`src/shared/agent-runner.ts`, `src/shared/agent-argv.ts`, `src/slices/child/guard.ts`, ADR 0002) | **Partially / different** | pi-pair spawns via pi-subagents with `context:"fork"` (1673); its read-only rule is **prose in the agent md** ("bash 仅只读命令", decision-auditor.md 70–83) and a tools allow-list in frontmatter — **no code-level `tool_call` guard**. Our guard blocks in code (`guard.ts:56–120`) and is not a peer plugin dependency. |
| **`psych_submit`** (`src/slices/child/submit.ts:54`; `lexicon.ts:276`) | **Not covered (analog exists)** | pi-pair's child writes prose/JSON into state.json and audit-log.md, not a single validated tool call. `psych_submit`'s "one call, throws on second, typed schema" is ours alone. pi-pair has a `decision_signoff` tool (988) but it signs state, not a typed answer. |
| **Context levels** (`evidence/digest/fork`, ADR 0002 §2; README:203, 253) | **Partially (forced to widest)** | pi-pair's automatic audit **always** forks the whole session (1673). There is no `evidence`/`digest` level; consent is not a knob. |
| **`/psych scout`** (`src/slices/scout/index.ts`, README:246) | **Not covered** | pi-pair has no package-discovery role. |
| **`/psych ask`** (`src/shared/ask.ts`, README:245) | **Not covered** | No consult path; its only interaction tool is `contact_supervisor`, used by the auditor toward the main session (decision-auditor.md 122–128), not user→plugin. |

---

## 7. Gaps and cost

**What pi-pair does not do that our pair role (ADR 0001) would:**

1. **It never checks convention adherence against a stated rule.** ADR 0001 invariant 3 requires
   reading `AGENTS.md` and citing a rule. pi-pair's five dimensions (atomicity…completeness) are
   generic; there is no `AGENTS.md` read, no project-rule citation pipeline. That is exactly the
   "different, stronger model + convention checking" claim T32 makes (plan 592).
2. **It does not use a stronger model.** Model is inherited from the main session unless
   `PI_PAIR_AUDITOR_MODEL` is set (190, README:242); cross-model is *rejected by design*. Our
   capability-arbitrage premise (ADR 0001 "Why the reviewer role is worth building" §1) is the
   opposite.
3. **Same-model blind spots are acknowledged, not solved.** README:242: "shared blind spots
   (both miss the same thing) are still possible."
4. **No measurement of whether it helps.** Outcome ledger / `followed` / kill criteria are absent
   (README Roadmap 249). The T32/ADR 0001 "if fewer than half findings accepted" kill criterion
   cannot be computed from pi-pair.
5. **Continuous cost, not token-free.** Our T15 names an unverified commit for **0 tokens**; pi-pair
   spawns a forked child (plus an L2 reviewer on delivery), every commit round.
6. **It reads and stores conversation bodies on disk** (convlog, 1709–1730), which our `evidence`
   level deliberately avoids.
7. **It depends on a peer plugin** (pi-subagents, README:55/131), whereas our guard and runtime
   are self-contained (ADR 0002 §3).

**Workshop context (skeptical):** the workshop already has `pi-quick-win`, `pi-lens`,
`pi-subagents`, `pi-openrouter-accounts` + multi-account OpenRouter, and the scout previously
found `pi-gauntlet` (verify-before-ship). So pi-pair's delivery gate overlaps `pi-gauntlet`'s
"verify before ship", and its spawner is `pi-subagents`, which we already have. The only part of
pi-pair that is *not* duplicated by something in the workshop is the decision-chain + adversarial
chain audit protocol — and that is a documentation/proof discipline, not the reviewer role T32
describes.

**Cost to add pi-pair *instead of* shipping T32:**

- Install `npm:pi-pair` (README install) and **also** `pi-subagents` with the agent auto-discovered
  (README local-path note, 133). That is a new third-party package running in **every** session:
  it hooks `agent_end`, `message_end`, `before_agent_start` (751–1250, 2154).
- A whole-session fork per audit round (1673) → real token cost; L2 adds a second run (402).
- New `.pi/decision-auditor/` tree in every working repo (chain/convlog/process/state/audit-log),
  with **user prompt text on disk** (1714–1730).
- Its findings are injected into the working agent's context (1289–1310, 2069–2076), overriding our
  default `steerAgent: false` ("an observer is not an authority", README:188).
- It still would **not** deliver the T32 value proposition (stronger model + stated-convention
  checking) — that is the gap it leaves.

**Concrete, skeptical bottom line:** pi-pair is a mature, heavily-hardened proof-chain tool
(the code is dense with real incident references — v1.0.x bug regressions), but its purpose is
*decision-chain provenance auditing*, not *artifact review by a stronger model*. Adopting it buys
a decision log and a same-model adversarial checklist; it does not buy the reviewer role, and it
adds a fork-per-round cost, a peer-plugin dependency, and a conversation-body log.

---

## 8. Security / operational notes

- **Runs in every pi session once installed:** hooks `session_start` / `session_shutdown` /
  `before_agent_start` / `agent_end` / `message_start` / `message_end`
  (`decision-chain.ts:751, 803, 1249, 1457, 2126, 2154`). It reads git state (`gitHead`,
  `hasUncommittedChanges`) and the full conversation stream.
- **Needs pi-subagents:** yes — hard dependency for every spawn (README:55, 131; RPC client
  93–105). Without it, spawn fails and its own error text says to install pi-subagents (1215).
- **Env vars:** `PI_PAIR_CHAIN_PUBLIC`, `PI_PAIR_PROCESS_LOG`, `PI_PAIR_PROJECT_ROOT`,
  `PI_PAIR_LANG`, `PI_PAIR_AUDITOR_MODEL` (README:211–215; code 190, 494; chain-store 41, 78).
  `PI_PAIR_CHAIN_PUBLIC=1` moves the chain and audit-log into `docs/decisions/` **inside git**.
- **Writes user prompt text to disk:** `convlog.md` (chain-store 1709–1730) — up to 800 chars per
  user prompt per turn, plaintext.
- **Its own README limitations (README:239–246):**
  - print-mode `agent_end` does not block — gate semantics hold only in TUI/RPC (241).
  - same-model auditor ⇒ shared blind spots (242).
  - CI E2E uses a free no-key model; audit verdicts are model-dependent (243).
  - multi-instance same-cwd shares `convlog.md`; auto-audit is skipped with a warning when foreign
    runs are detected (244; code 1479–1496).
  - Roadmap admits benefit measurement and L1 tiering are unbuilt (248–252).
- **Read-only guarantee is prose, not code.** The auditor's `agents/decision-auditor.md:70–83`
  forbids mutating bash and restricts tools by frontmatter allow-list, but the extension registers
  **no `tool_call` guard**, so the working agent's own tool calls are untouched and the child's
  read-only property rests on the agent prompt + the pi-subagents tool list.

---

## Verdict

(a) **Does pi-pair leave a gap worth a T32 build?** **Yes, but a narrow one.** pi-pair leaves
untouched exactly the two things T32 names: a **different, stronger model** than the worker
(rejected by pi-pair by design, `decision-chain.ts:190` + README:242) and **convention checking
against a stated rule** such as `AGENTS.md` (ADR 0001 invariant 3). Everything else T32 described —
a commit-anchored trigger and a read-only child — pi-pair already proves feasible
(`agent_end` 1457, `context:"fork"` 1673), so T32 can shrink to "same spawn seam, stronger model,
`AGENTS.md` rule citation."

(b) **What pi-pair would give us if installed:** a hardened, append-only decision chain with
adversarial proof-log auditing (`chain.md`, `audit-log.md`, `gaps.md`), a git-HEAD delivery gate
with non-blocking 300 s polling and fix-loop (`agent_end` 1457–1930), and a fork-per-round
same-model auditor — i.e. a decision-provenance log, not an artifact reviewer.

(c) **What it would cost:** a peer-plugin dependency (pi-subagents), a whole-session fork per
audit round plus an L2 reviewer on delivery (`extensions/decision-chain.ts:1673, 402`), a
`.pi/decision-auditor/` tree in every repo with **user prompt text on disk** (`lib/chain-store.ts:1709–1730`),
findings injected into the working agent's context against our `steerAgent: false` default
(`extensions/decision-chain.ts:1289–1310, 2076`), and it still would not deliver the
stronger-model / stated-convention value T32 exists for. Add it for the decision log if that is
independently wanted; do not ship it *instead of* T32 and expect the reviewer role.
