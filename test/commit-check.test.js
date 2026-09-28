/**
 * Delivery-boundary check (T15) — a commit that ships unverified work, named for zero tokens.
 *
 * The rule these tests defend (D8): the plugin OBSERVES a delivery boundary, it never blocks or
 * delays the command. A successful commit with a pending change set fires exactly one
 * notification and adds exactly one evidence line; a verified set, a failed command, or
 * `commitCheck: false` produce nothing at all.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { makeCtx, makePi, makeState } from "./fakes.js";
import { registerObserver } from "../src/slices/observer/index.js";
import { notifyUnverifiedCommit } from "../src/slices/interventions/index.js";
import { extractSignals } from "../src/shared/signals.js";
import { signalOptions } from "../src/shared/state.js";
import { isCommitCommand } from "../src/shared/lexicon.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { LOCALES, stringsFor } from "../src/shared/i18n.js";

const line = (n) => `commit after ${n} file change(s) with no verified run since`;

function wired(over = {}) {
  const pi = makePi();
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, ...over };
  const ctx = makeCtx();
  registerObserver(pi, state, {
    // The real delivery function, so the notification text and its hasUI guard are exercised.
    notifyUnverifiedCommit: (c, count) => notifyUnverifiedCommit(c, state.config.lang, count),
  });
  return { pi, state, ctx };
}

async function edit(pi, ctx, id, path) {
  await pi.emit("tool_execution_start", { toolCallId: id, toolName: "edit", args: { path } }, ctx);
  await pi.emit("tool_execution_end", { toolCallId: id, toolName: "edit", result: {}, isError: false }, ctx);
}

async function bash(pi, ctx, id, command, isError = false) {
  await pi.emit("tool_execution_start", { toolCallId: id, toolName: "bash", args: { command } }, ctx);
  await pi.emit("tool_execution_end", { toolCallId: id, toolName: "bash", result: {}, isError }, ctx);
}

test("two edits then a commit: one notification and one line with N=2", async () => {
  const { pi, state, ctx } = wired();
  await edit(pi, ctx, "1", "a.ts");
  await edit(pi, ctx, "2", "b.ts");
  await bash(pi, ctx, "3", "git commit -m x");

  assert.equal(ctx.notes.length, 1, "exactly one notification, never a card");
  assert.equal(ctx.notes[0].message, line(2));
  assert.equal(ctx.notes[0].level, "info");

  const signals = extractSignals(state.observations, signalOptions(state));
  assert.equal(signals.unverifiedCommits, 1);
  assert.ok(signals.evidence.includes(line(2)), "and the same fact is citable evidence");
});

test("edit, a successful run, then a commit: silence is the success path", async () => {
  const { pi, state, ctx } = wired();
  await edit(pi, ctx, "1", "a.ts");
  await bash(pi, ctx, "2", "npm test");
  await bash(pi, ctx, "3", "git commit -m x");

  assert.deepEqual(ctx.notes, [], "a verified change set is not worth a word");
  const signals = extractSignals(state.observations, signalOptions(state));
  assert.equal(signals.unverifiedCommits, 0);
  assert.ok(!signals.evidence.some((l) => l.startsWith("commit after")));
});

test("a failed commit command produces nothing", async () => {
  const { pi, state, ctx } = wired();
  await edit(pi, ctx, "1", "a.ts");
  await bash(pi, ctx, "2", "git commit -m x", true);

  assert.deepEqual(ctx.notes, []);
  assert.equal(extractSignals(state.observations, signalOptions(state)).unverifiedCommits, 0);
});

test("commitCheck:false silences the notification, the line and the trigger", async () => {
  const { pi, state, ctx } = wired({ commitCheck: false });
  await edit(pi, ctx, "1", "a.ts");
  await bash(pi, ctx, "2", "git commit -m x");

  assert.deepEqual(ctx.notes, []);
  const signals = extractSignals(state.observations, signalOptions(state));
  assert.equal(signals.unverifiedCommits, 0);
  assert.ok(!signals.evidence.some((l) => l.startsWith("commit after")));
});

test("git push after unverified edits fires the same way git commit does", async () => {
  const { pi, ctx } = wired();
  await edit(pi, ctx, "1", "a.ts");
  await bash(pi, ctx, "2", "git push origin main");

  assert.equal(ctx.notes.length, 1);
  assert.equal(ctx.notes[0].message, line(1));
});

test("the command lexicon matches delivery boundaries and nothing else", () => {
  for (const command of ["git commit -m x", "git commit", "git push", "gh pr create --fill", "npm publish"]) {
    assert.equal(isCommitCommand(command), true, command);
  }
  for (const command of ["pi update", "npm test", "git status", "git log --oneline", undefined]) {
    assert.equal(isCommitCommand(command), false, String(command));
  }
});

test("the notification key exists in both locales and English mirrors the evidence line", () => {
  for (const locale of LOCALES) {
    const text = stringsFor(locale).commitUnverified(3);
    assert.ok(text.trim().length > 0, `${locale}.commitUnverified is empty`);
    assert.ok(text.includes("3"), `${locale}.commitUnverified must carry the count`);
  }
  assert.equal(stringsFor("en").commitUnverified(3), line(3));
});

test("no UI means no notification is attempted", async () => {
  const { pi, state } = wired();
  const ctx = makeCtx({ hasUI: false });
  await edit(pi, ctx, "1", "a.ts");
  await bash(pi, ctx, "2", "git commit -m x");
  assert.deepEqual(ctx.notes, []);
  assert.equal(state.observations.filter((o) => o.kind === "tool").length, 2, "the recording still happened");
});
