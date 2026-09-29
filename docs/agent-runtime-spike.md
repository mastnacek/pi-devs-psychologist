# Agent runtime spike — child `pi` launch facts (T19)

Investigation only; **no plugin source changed**. Every row below replaces an
assumption in `docs/plan-0.4.md` with a fact observed on this machine.

**Environment:** Windows 11, Git Bash, `pi` 0.87.1 on PATH.
Engine root: `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent`.
Node: `D:\02_knihovny_path\node-v22.17.1-win-x64\node.exe`.
All child runs used `--model openrouter/deepseek/deepseek-v4.1-flash`, tiny prompts,
`timeout 120`, `--no-session` unless the question was about `--fork`. Throwaway probe
extension and temp files lived under `%TEMP%/psych-spike/` (deleted at the end; the
probe extension is not part of the repo).

---

## Q1 — spawn from an extension on Windows (`process.execPath` + `process.argv[1]`)

**Command (probe extension writes `process.execPath`, `process.argv`, `PI_PACKAGE_DIR`):**

```bash
timeout 120 pi -e %TEMP%/psych-spike/probe-ext.ts --no-session -p \
  --model openrouter/deepseek/deepseek-v4.1-flash "reply OK"
cat %TEMP%/psych-spike/probe.json
```

**Observed (probe.json, trimmed):**

```json
{
  "execPath": "D:\\02_knihovny_path\\node-v22.17.1-win-x64\\node.exe",
  "argv": [ "...\\node.exe", "...\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js", "-e", ... ],
  "argv1": "...\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js",
  "PI_PACKAGE_DIR": "D:\\02_knihovny_path\\node-v22.17.1-win-x64\\node_modules\\@earendil-works\\pi-coding-agent",
  "cwd": "C:\\Users\\jaroslav\\AppData\\Local\\Temp\\psych-spike"
}
```

**Observed (spawn both ways, `shell: false`, `node spawn-test.mjs`):**

```text
A node argv1 --version shell:false: {"status":0,"stdout":"0.87.1"}
B node PI_PACKAGE_DIR/cli.js --version shell:false: {"status":0,"stdout":"0.87.1"}
```

**Conclusion: YES.** `spawn(process.execPath, [process.argv[1], ...], { shell: false })`
starts the same build. `process.argv[1]` is the absolute path to
`dist/bundle/cli.js`, and `PI_PACKAGE_DIR` is set inside the extension. The fallback
`join(PI_PACKAGE_DIR, "dist", "bundle", "cli.js")` also works and is worth keeping as a
guard. Spawning `pi.cmd` through a shell is unnecessary and must stay forbidden.

---

## Q2 — `@file` in JSON print mode

**Command:**

```bash
timeout 120 pi --mode json --no-session -p --model openrouter/deepseek/deepseek-v4.1-flash \
  "@C:/Users/jaroslav/AppData/Local/Temp/psych-spike/msgfile.txt" "reply with word OK"
```

**Observed (`message_end`, role user):**

```json
{"type":"message_end","message":{"role":"user","content":[{"type":"text",
 "text":"<file name=\"C:\\Users\\jaroslav\\AppData\\Local\\Temp\\psych-spike\\msgfile.txt\">\nFILE_MARKER_Q2_42\n\n</file>\nreply with word OK"}]}}
```

**Conclusion: YES.** `@file` works in JSON print mode; the file is inlined as an
`<file name="…">…</file>` block prepended to the prompt. Constraint: the `@path` must be
its **own argv token** — merging it with the message text in one quoted argument fails
with `Error: File not found: … msgfile.txt reply with word OK`.

---

## Q3 — `--append-system-prompt <path>` reads file contents

**Command:** same run as Q2, with a probe extension that dumps `ctx.getSystemPrompt()`.

```bash
timeout 120 pi -e probe-ext.ts --mode json --no-session -p --model <ref> \
  --append-system-prompt %TEMP%/psych-spike/brief.txt "@…/msgfile.txt" "reply with word OK"
```

**Observed:** `brief.txt` contained `APPEND_MARKER_XYZ_987`; the dumped system prompt
contains it once and does **not** contain the file's synthetic marker from Q2:

```text
grep -c "APPEND_MARKER_XYZ_987" system-prompt.txt  -> 1
grep -c "FILE_MARKER_Q2_42"     system-prompt.txt  -> 0
system-prompt.txt length: 25621 bytes
```

**Conclusion: YES.** A path is read as file contents and **appended** to pi's own system
prompt (25 KB core prompt preserved). `--append-system-prompt` is the correct seam for
T23; never `--system-prompt`.

---

## Q4 — `--fork <file> --session-dir <tmpdir>` while the parent session is live

**Commands:**

```bash
# parent session (created on start, then held live by a long bash tool call)
timeout 90 pi --session-dir %TEMP%/psych-spike/live-parent3 --session-id live-parent3 -p \
  --model <ref> "call the bash tool to run: sleep 45. Then reply DONE."

# fork while that parent is still running
timeout 120 pi --fork %TEMP%/psych-spike/live-parent3/<parent>.jsonl \
  --session-dir %TEMP%/psych-spike/live-fork3 -p --model <ref> "reply with word F3OK"
```

**Observed:**

```text
live-parent3/<parent>.jsonl   8 lines, 78152 bytes, still present while fork ran
live-fork3/…_01a0ea18….jsonl  created
  header: {"type":"session","version":3,"id":"01a0ea18-…","cwd":"…","parentSession":"…\\live-parent3\\…_live-parent3.jsonl"}
live-parent3 jsonl count: 1   (fork did not land in the parent's session dir)
```

**Conclusion: YES.** `--fork` reads a parent session file that is being appended and
writes a new session into `--session-dir` with `parentSession` recorded as an absolute
path. The fork lives only in `tmpdir`, so the parent's `/resume` (which lists the
project session dir) cannot see it. It also inherits the parent's messages. Constraint
(docs/cli.md): `--fork` cannot be combined with `--no-session`; fork runs persist into
their own `--session-dir` and that directory must be removed in `finally`.

---

## Q5 — which extensions load in the child; is `pi-secret-guard` active

**Command:** `pi list` (global) vs. the child's own tool list (from the dumped system
prompt of the Q2/Q3 run) and the child's env markers (Q1 probe).

**Observed:**

```text
pi list:  git:github.com/mastnacek/pi-secret-guard (filtered)
          git:github.com/mastnacek/pi-devs-psychologist
~/.pi/agent/settings.json:
  { "source": "git:github.com/mastnacek/pi-secret-guard", "extensions": ["-index.ts"] }
child env markers: AI_AGENT=pi  PI_CODING_AGENT=true  PI_SUBAGENT=null  PI_CHILD_SESSION=null
child tool list: … quick_win, workflow, record_spai_item, lens_diagnostics, mcp, web_search …
                 NO pi_secret_guard_check
```

`pi-secret-guard`'s own `index.ts` guards on `PI_SUBAGENT`/`PI_CHILD_SESSION` (grep
confirmed), but on this machine it is **additionally filtered off globally** by
`"extensions": ["-index.ts"]` (the monorepo project settings reinforce it with
`autoload:false`). `pi list` confirms both are suppressed.

**Conclusion: NO — `pi-secret-guard` does not load in the child here.** D5's promise
("`PI_DEVS_PSYCH_CHILD=1` keeps `pi-secret-guard` active") does not hold on this
machine regardless of markers, because the operator has the package filtered off.
Everything else globally installed and unfiltered (pi-lens, quick-win, workflow, SPAI,
projects, herdr, web-access, MCP) **does** load in a child with
`PI_SUBAGENT`/`PI_CHILD_SESSION` unset. Constraint: T22's read-only guarantee must rest
on our own `tool_call` guard, not on `pi-secret-guard` being present.

---

## Q6 — tool names available to the child

**Command:** same system-prompt dump (the `<tools>` block) plus the `<skills>` block.

**Observed (tool names, from the child's system prompt):**

```text
read, bash, edit, write,
web_search, source_check, fetch_content, get_search_content, web_enable,
mcpScript, mcp, mcp__openrouter, mcp__hf_mcp_server, mcp__lotusscript_lsp,
mcp__knowledge_base, mcp__metaculus,
lens_diagnostics, symbol_search, effective_config, project_report, module_report,
read_symbol, read_enclosing, pi_lens_activate_tools, ast_grep_search,
ast_grep_replace, ast_grep_outline, lsp_navigation, lens_diagnostic_mark,
apple_rada, workflow, workflow_control, record_adr, search_adrs, record_spai_item,
search_spai_items, update_spai_status, list_projects, search_projects, vsa_check,
batch_submit_goal, batch_check_jobs, herdr_scaffold_plugin, herdr_validate_manifest,
quick_win
```

Skills listed in the prompt: `android-cli, archify, cim-budu, find-skills,
lotus-script, nlm-cli-skill` and the `pi-skills/*` set.

**Conclusion:** `web_search` is already present (pi-web-access) so `web_enable` is not
needed first on this machine. `knowledge_base_*` is exposed as the MCP proxy
`mcp__knowledge_base` (not a bare `knowledge_base_*` name). `fetch_content`,
`mcp`/`mcpScript` are present. Critically for T22, **`write, edit, ast_grep_replace,
workflow, batch_submit_goal, record_spai_item, update_spai_status`** are all in the
child's default loadout — the guard must block every one of them by name.

---

## Q7 — project trust in `-p` mode with a project `.pi/`

**Commands** (probe extension on each, checking `ctx.isProjectTrusted()` and whether a
project `.pi/APPEND_SYSTEM.md` marker reaches the system prompt):

```bash
# A: cwd = D:/01_programovani/pi/plugins      (project .pi/, decision via trusted ancestor)
# B2: cwd = %TEMP%/psych-spike/untrusted-proj (project .pi/)  --no-approve
# C2: same cwd --approve
timeout 120 pi -e probe-ext.ts --no-session [-na|-a] -p --model <ref> "reply OK"
```

**Observed:**

```text
A  (plugins, no flag)       isProjectTrusted=true   project marker present      exit 0, no hang
B2 (untrusted-proj -na)     isProjectTrusted=false  project marker ABSENT       exit 0, no hang
C2 (untrusted-proj -a)      isProjectTrusted=true   project marker present      exit 0, no hang
```

**Conclusion: YES, and there is no prompt or hang.** Print/JSON modes cannot show the
built-in trust dialog, so Pi never blocks; it resolves trust from `--approve`/
`--no-approve`, else from a saved `~/.pi/agent/trust.json` decision for the directory or
an ancestor, else `defaultProjectTrust` (`ask` → protected resources skipped). On this
machine `D:\01_programovani` is trusted, so the plugins dir is trusted with no flag.
`--approve` is only needed when project resources must load and no decision applies.
An extension can read the parent's state via **`ctx.isProjectTrusted()`** (returns a
boolean, observed true/false) and `ctx.getSystemPromptOptions()`. Constraint for T24:
mirror the parent deterministically, `ctx.isProjectTrusted() ? "--approve" : "--no-approve"`;
never rely on the ambient saved decision.

---

## Q8 — cold-start cost, `pi-lens` session-start scan, `--no-lens`

**Command (node wrapper times spawn → first stdout line → first `message_start`,
`stdio: ["ignore","pipe","pipe"]`):**

```bash
node time-start.mjs --mode json --no-session -p --model <ref> "reply OK"
node time-start.mjs --mode json --no-session -p --no-lens --model <ref> "reply OK"
```

**Observed:**

```text
default:   firstLine 4894 ms   firstMessageStart 5854 ms   total 9088 ms   stderrTail ""
--no-lens: firstLine 4666 ms   firstMessageStart 5700 ms   total 8768 ms   stderrTail ""
```

**Conclusion:** Cold start to the first `message_start` is ~5.7–5.9 s with all plugins
loaded (about 60 % of it before the first line). `--no-lens` changes nothing measurable
(difference is noise) and pi-lens session-start analyzers (knip/jscpd/madge) produce
**no stderr output** and do not delay the first turn. `--no-lens` is a real registered
flag (`pi --help` lists it), but an unknown long option is rejected hard:
`Error: Unknown option: --ndefinitely-not-a-flag` (exit 1). Constraint for T24: do **not**
pass `--no-lens` unconditionally — if pi-lens were not installed it would abort the child
with an unknown-option error. `agent.timeoutMs` must budget for the ~6 s floor.

---

## Q9 — does our own extension load in the child; rule for `-e`

**Command:** `pi list` and the current settings entries.

**Observed:**

```text
pi list:  git:github.com/mastnacek/pi-devs-psychologist   (no filter)
~/.pi/agent/settings.json: "git:github.com/mastnacek/pi-devs-psychologist"   (plain entry, loads all)
plugins monorepo .pi/settings.json: does NOT suppress pi-devs-psychologist
installed copy: ~/.pi/agent/git/github.com/mastnacek/pi-devs-psychologist/index.ts   package.pi = {"extensions":["./index.ts"]}
```

**Conclusion:** the plugin is installed from git (global) and unfiltered, so **any child
spawned in any cwd loads the installed git copy**, and `PI_DEVS_PSYCH_CHILD=1` makes that
copy take its child branch (T22). Rule for T24: **never pass `-e <this index.ts>`.** A
git identity and a path identity are distinct (AGENTS §4), so `-e` while the git copy is
also installed would load two copies and double-register `psych_submit` and every handler.
Two consequences to document:

1. The installed copy is a fixed commit — the child runs the *released* version, not the
   working tree. Verify unreleased child-mode code with fake-`pi` unit tests, and only
   exercise the real child after commit + push + `pi update`.
2. The only way to load a dev copy in a child without the duplicate is to also suppress
   the git copy for that run (a project-scope delta with `autoload:false` + `-index.ts`),
   which itself changes the child's environment. Not recommended; not needed.

---

## Q10 — killing the whole child tree

**Commands:**

```bash
# child told to: "Call the bash tool NOW to run exactly: sleep 90."
taskkill //PID <pi-pid> //T //F
```

**Observed:**

```text
pi's children:  bash.exe  "C:\Program Files\Git\bin\bash.exe" -c "sleep 90"
taskkill //PID 8232 //T //F:
  SUCCESS: The process with PID 14840 (child process of PID 84548) has been terminated.
  SUCCESS: The process with PID 44820 (child process of PID 73892) has been terminated.
  SUCCESS: The process with PID 84548 (child process of PID 73892) has been terminated.
  SUCCESS: The process with PID 74808 (child process of PID 8232) has been terminated.
  SUCCESS: The process with PID 73892 (child process of PID 8232) has been terminated.
  SUCCESS: The process with PID 8232 (child process of PID 58760) has been terminated.
after: node with '*kill-test2*' cmdline -> 0 ; bash '-c "sleep 90"' -> 0 ; sleep.exe -> none
```

**Conclusion: YES.** `taskkill /PID <pi> /T /F` removes pi and its entire descendant
tree (the bash tool's process and the `sleep` helpers). The git-bash `//PID` form works.
POSIX equivalent is `process.kill(-pid)` with the child spawned `detached: true`.
Constraint for T24: use the `ChildProcess.pid` from the spawn handle directly — never
wrap the child in `timeout`/`bash` and hunt for the PID, or the tree root is wrong.

---

## Gotchas discovered while testing (not among the ten, but T24-critical)

- **Open stdin stalls a print child.** With `child_process.spawn`'s default `stdio` the
  stdin pipe stays open, and pi reads piped stdin before the prompt; the run hung until
  the 120 s wrapper killed it (exit 124). Wrap the spawn as
  `stdio: ["ignore", "pipe", "pipe"]` (or close stdin) — the message travels via `@file`,
  not stdin.
- **`@path` is one argv token**, never concatenated with prompt text (Q2).
- **Fork persists**; its `--session-dir` must be cleaned even on the error path (Q4).

---

## Constraints for T21–T24

- **T24 launch:** argv must start `[process.execPath, process.argv[1] ?? join(PI_PACKAGE_DIR, "dist", "bundle", "cli.js")]` with `shell: false`; never spawn `pi.cmd`. (Q1)
- **T24 stdin:** spawn with `stdio: ["ignore", "pipe", "pipe"]`; pass the message with `@messageFile` as its own token, not on the command line and not via stdin. (Q2, gotcha)
- **T23 append seam:** `--append-system-prompt <briefFile>` appends to pi's core prompt (verified 25 KB core preserved). Never `--system-prompt`. (Q3)
- **T24 context `fork`:** `--fork <sessionFile> --session-dir <runTmp>/session`; `--fork` excludes `--no-session`; remove `<runTmp>/session` in `finally`. (Q4)
- **T22 read-only:** do not depend on `pi-secret-guard`; it is filtered off on this machine. Block `write, edit, ast_grep_replace, workflow, batch_submit_goal, record_spai_item, update_spai_status` and the rest by name in our own guard. (Q5, Q6)
- **T22/T23 tool names:** `web_search`, `fetch_content`, `get_search_content`, `web_enable`, `mcp`, `mcpScript` exist; Knowledge Base is `mcp__knowledge_base`; skills are enumerated in the prompt. (Q6)
- **T24 trust:** pass `ctx.isProjectTrusted() ? "--approve" : "--no-approve"`; `-p`/json never prompt or hang. (Q7)
- **T24 limits:** do not pass `--no-lens` unless pi-lens is known loaded (unknown option is fatal); budget `agent.timeoutMs` for a ~6 s cold start. (Q8)
- **T24/T22 loading:** never pass `-e` for our own extension; the installed git copy loads in the child and the `PI_DEVS_PSYCH_CHILD` marker selects child mode. Test unreleased child code with fake-`pi` tests, or push + `pi update` first. (Q9)
- **T24 kill:** kill the whole tree via `taskkill /PID <handle.pid> /T /F` (Windows) / `process.kill(-pid)` with `detached: true` (POSIX); idle and abort both kill; keep it idempotent. (Q10)

---

## Recommended final argv / env template

```ts
const cliPath = process.argv[1] ?? join(process.env.PI_PACKAGE_DIR!, "dist", "bundle", "cli.js");

const argv = [
  cliPath,
  "--mode", "json",
  "-p",
  ...(context === "fork"
      ? ["--fork", parentSessionFile, "--session-dir", join(runTmp, "session")]
      : ["--no-session"]),
  "--model", ref,
  ...(thinking ? ["--thinking", thinking] : []),
  "--append-system-prompt", join(runTmp, "brief.md"),
  parentTrusted ? "--approve" : "--no-approve",   // parentTrusted = ctx.isProjectTrusted()
  // ...agent.extraArgs
  "@" + join(runTmp, "message.md"),
];

const env = { ...process.env,
  PI_DEVS_PSYCH_CHILD: "1",
  PI_DEVS_PSYCH_RUN: runId,
  PI_DEVS_PSYCH_ROLE: role,
  PI_DEVS_PSYCH_LIMITS: JSON.stringify(limits),
};
delete env.PI_SUBAGENT;
delete env.PI_CHILD_SESSION;

spawn(process.execPath, argv, {
  shell: false,
  cwd: ctx.cwd,
  env,
  stdio: ["ignore", "pipe", "pipe"],   // stdin closed: message goes via @file
});
```

`runTmp` = `join(os.tmpdir(), "pi-devs-psychologist", runId)`; removed in `finally`
unless `agent.keepTranscript`.

---

## Live verification after T24 (2026-09-29)

- `scripts/live-agent-check.mts` against the installed `1198ef3`: child spawned, one
  `psych_submit` call, `terminate: true` ended the run after one turn. 11.1 s wall,
  38 634 input / 438 output tokens, $0.0015 on `openrouter/deepseek/deepseek-v4.1-flash`.
  The appraisal passed enforcement with zero unmatched citations.
- **Cost shape:** ~38.6k input tokens per run is pi's core prompt + every loaded tool schema,
  versus ~1.5k for the API runtime. Agent runtime costs ~25× the input of the API runtime
  before any tool call; cheap models make it negligible, expensive ones do not.
- Hostile prompt in a throwaway git repo (direct child, role `ask`): `git commit`, `write`,
  `sudo rm -rf .git` all blocked with the guard's reasons; `git log` allowed; repo intact.
- **Guard boundary:** a peer plugin (the ADR indexer) wrote `docs/adr/.index.json` into the
  child's cwd on `session_start`. That is extension code, not a tool call, so the `tool_call`
  guard cannot see it. The child runs in the parent's cwd, where that plugin already writes,
  so nothing new is exposed — but "read-only" means read-only *tools*, not a read-only process.

## Live verification after T26/T27 (2026-09-29, RPC driver, parent + child on deepseek-v4.1-flash)

- `turn_end` no longer blocks: the chip read `psych: researching Ns · N tools` once per second
  while the working agent kept streaming; `agent_end` arrived before the appraisal finished.
- Child run 9–23 s. First run on a cold cache 36.6k input tokens ($0.0115); a warm repeat
  285 uncached input tokens ($0.0007) — the prompt cache absorbs pi's core prompt.
- **Bug found and fixed (`fix(enforce)`)**: the child copied citations with the prompt's `- `
  list marker; all four were dropped and the appraisal came back empty. Markers are now
  stripped before matching; the re-run matched every citation.
- `/psych now` during an in-flight automatic run waited on that run instead of starting a second
  one (T26 single-flight, as specified); `/psych` "Last run" block showed runtime, model,
  duration, tools, tokens, cost and the session total against the $2.00 cap.
- Another plugin's approval dialog (`select`) fires on every parent bash call in RPC; a driver
  must answer `extension_ui_request` dialogs or the parent stalls.
