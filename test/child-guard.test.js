/**
 * child-guard — the read-only rule, driven table-first.
 *
 * The guard is the only enforcement the child has (spike Q5: no peer plugin can be assumed), so the
 * tests state the rule twice: once as the list of things that must be refused, once as the list of
 * things a read-only appraisal still needs. The second list is the one that catches an over-eager
 * pattern — a guard that also blocks `git log` is a guard that starves the answer.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CHILD_LIMITS } from "../src/shared/child-limits.js";
import { guardToolCall } from "../src/slices/child/guard.js";

/** Everything permitted, so a capability gate never masks the rule under test. */
const OPEN = { maxToolCalls: 25, allowWeb: true, allowMcp: true, allowNlm: true };

function call(toolName, input = {}, limits = OPEN, budget = { allowedCalls: 0 }) {
  return guardToolCall({ toolName, input }, limits, budget);
}

const FORBIDDEN_TOOLS = [
  // named in T22
  "edit",
  "write",
  "ast_grep_replace",
  "record_spai_item",
  "update_spai_status",
  "workflow",
  "workflow_control",
  "batch_submit_goal",
  "subagent",
  "subagents_enable",
  "plugin_dev_scaffold",
  "add_project_root",
  "add_project_manually",
  // the codebase's own mutation set, and names the pattern must catch without being listed
  "apply_patch",
  "str_replace",
  "fs_delete",
  "install_plugin",
  "something_writer",
  "remove_project",
];

for (const tool of FORBIDDEN_TOOLS) {
  test(`the tool "${tool}" is refused`, () => {
    const verdict = call(tool);
    assert.equal(verdict?.block, true);
    assert.match(verdict.reason, /read-only/);
    assert.match(verdict.reason, /psych_submit/);
  });
}

test("the tool name is in the reason, so the model knows which call was refused", () => {
  assert.match(call("workflow").reason, /workflow/);
});

const FORBIDDEN_BASH = [
  "git commit -m wip",
  "git push origin main",
  "git reset --hard",
  "git checkout main",
  "git switch main",
  "git clean -fd",
  "git rebase main",
  "git merge origin/main",
  "git stash",
  "git tag v1.0.0",
  "git rm file.txt",
  "git mv a b",
  "rm -rf build",
  "rmdir empty",
  "del out.txt",
  "Remove-Item -Recurse build",
  "mv a b",
  "move a b",
  "cp a b",
  "copy a b",
  "npm install",
  "npm i",
  "npm publish",
  "npm uninstall left-pad",
  "pnpm add lodash",
  "yarn install",
  "bun publish",
  "pi install npm:foo",
  "pi remove foo",
  "pi uninstall foo",
  "pi update",
  "pi config get model",
  "gh repo create x",
  "gh pr create -t x",
  "gh issue close 1",
  "gh release delete v1",
  "nlm notebook create n",
  "nlm source add s",
  "nlm note delete 1",
  "nlm login",
  "nlm chat start",
  "sed -i 's/a/b/' f.ts",
  "tee out.txt",
  "curl -o out.json https://example.com",
  "curl -O https://example.com/x.tgz",
  "Set-Content -Path f.txt -Value x",
  "Out-File f.txt",
  "echo hello > out.txt",
  "echo hello >> out.txt",
  // reached through a pipe or a chain, which a naive first-token test would miss
  "cd /tmp && rm -rf x",
  "cat f.txt | tee copy.txt",
  "ls; git push",
];

for (const command of FORBIDDEN_BASH) {
  test(`the bash command "${command}" is refused`, () => {
    const verdict = call("bash", { command });
    assert.equal(verdict?.block, true);
    assert.match(verdict.reason, /blocked:/);
    assert.match(verdict.reason, /psych_submit/);
  });
}

const ALLOWED_BASH = [
  "git diff",
  "git diff HEAD~1 --stat",
  "git log --oneline -5",
  "git show HEAD",
  "git status",
  "npm test",
  "npm run test",
  "ls",
  "cat README.md",
  "cat src/copy-utils.txt",
  "echo x 2>&1",
  "ls >/dev/null",
  "echo x > nul",
  "rg 'foo' src",
];

for (const command of ALLOWED_BASH) {
  test(`the bash command "${command}" is allowed`, () => {
    assert.equal(call("bash", { command }), undefined);
  });
}

test("NotebookLM reads pass while the notebook stays writable-by-nobody", () => {
  assert.equal(call("bash", { command: 'nlm notebook query abc "what is the progress principle?"' }), undefined);
  assert.equal(call("bash", { command: "nlm notebook create n" }).block, true);
});

const ALLOWED_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "source_check",
  "ast_grep_search",
  "lens_diagnostics",
  "symbol_search",
  "web_search",
  "mcp",
  "mcpScript",
  "mcp__knowledge_base",
];

for (const tool of ALLOWED_TOOLS) {
  test(`the tool "${tool}" is allowed`, () => {
    assert.equal(call(tool), undefined);
  });
}

test("a disabled web capability refuses the whole web family", () => {
  const limits = { ...DEFAULT_CHILD_LIMITS, maxToolCalls: 25 };
  for (const tool of ["web_search", "fetch_content", "get_search_content", "web_enable"]) {
    const verdict = call(tool, {}, limits);
    assert.equal(verdict?.block, true, tool);
    assert.match(verdict.reason, /web tools are disabled/);
  }
});

test("a disabled MCP capability refuses mcp, mcpScript and every server proxy", () => {
  const limits = { ...DEFAULT_CHILD_LIMITS, maxToolCalls: 25 };
  for (const tool of ["mcp", "mcpScript", "mcp__knowledge_base", "mcp__openrouter"]) {
    const verdict = call(tool, {}, limits);
    assert.equal(verdict?.block, true, tool);
    assert.match(verdict.reason, /MCP tools are disabled/);
  }
});

test("a disabled NotebookLM capability refuses any nlm command, read or write", () => {
  const limits = { ...DEFAULT_CHILD_LIMITS, maxToolCalls: 25 };
  const verdict = call("bash", { command: 'nlm notebook query abc "q"' }, limits);
  assert.equal(verdict?.block, true);
  assert.match(verdict.reason, /NotebookLM is disabled/);
});

test("the budget stops everything except psych_submit", () => {
  const limits = { ...OPEN, maxToolCalls: 2 };
  const budget = { allowedCalls: 0 };
  assert.equal(call("read", {}, limits, budget), undefined);
  assert.equal(call("ls", {}, limits, budget), undefined);
  const third = call("grep", {}, limits, budget);
  assert.equal(third.block, true);
  assert.equal(third.reason, "tool budget exhausted — call psych_submit now with what you have");
  // The answer is the one thing the budget must never be able to starve.
  assert.equal(call("psych_submit", {}, limits, budget), undefined);
  // And a call the guard refused never ran, so it is not charged.
  assert.equal(budget.allowedCalls, 2);
});

test("a call refused for a capability does not spend the budget it was refused for", () => {
  const limits = { ...DEFAULT_CHILD_LIMITS, maxToolCalls: 1 };
  const budget = { allowedCalls: 0 };
  assert.equal(call("web_search", {}, limits, budget).block, true);
  assert.equal(call("edit", {}, limits, budget).block, true);
  assert.equal(call("bash", { command: "git push" }, limits, budget).block, true);
  assert.equal(budget.allowedCalls, 0, "nothing ran, so nothing was spent");
  assert.equal(call("read", {}, limits, budget), undefined);
  assert.equal(call("ls", {}, limits, budget).block, true, "the one allowed call is gone");
});

test("psych_submit survives a zero budget", () => {
  const limits = { ...DEFAULT_CHILD_LIMITS, maxToolCalls: 0 };
  const budget = { allowedCalls: 0 };
  assert.equal(call("read", {}, limits, budget).block, true);
  assert.equal(call("psych_submit", {}, limits, budget), undefined);
});

test("a forbidden tool is named as forbidden even when the budget is also gone", () => {
  const limits = { ...DEFAULT_CHILD_LIMITS, maxToolCalls: 0 };
  const verdict = call("write", {}, limits, { allowedCalls: 0 });
  assert.match(verdict.reason, /write/);
  assert.match(verdict.reason, /read-only/);
});

test("a bash call with no command is not a crash and not a block", () => {
  assert.equal(call("bash", {}), undefined);
  assert.equal(call("bash", { command: 42 }), undefined);
});
