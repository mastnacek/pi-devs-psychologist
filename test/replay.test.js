/**
 * Replay harness — the pure session reader, the windowing, the command, and the two-run eval.
 *
 * The contract these tests defend: a past session file folds to the SAME observations the live
 * observer would have produced, the offline prompt is byte-identical to a live one, no message body
 * ever reaches the report, and the eval is arithmetic rather than opinion.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readReplay } from "../src/shared/replay.js";
import { sliceWindows } from "../src/shared/replay-windows.js";
import { buildUserText } from "../src/shared/prompt.js";
import { evaluateRuns, measureWindow } from "../src/shared/replay-eval.js";
import { parseAppraisal, enforceEvidence } from "../src/shared/appraisal-enforce.js";
import { neutralAppraisal } from "../src/shared/appraisal.js";
import { replayCommandHandler } from "../src/slices/replay/index.js";
import { completePsych } from "../src/slices/commands/index.js";
import { stringsFor } from "../src/shared/i18n.js";
import { makeCtx, makeState } from "./fakes.js";

const T0 = 1_700_000_000_000;
const iso = (ms) => new Date(ms).toISOString();
const json = (entry) => JSON.stringify(entry);

/**
 * A session with counted properties, written by hand exactly as the engine writes one: a header, two
 * operator prompts, a `bash` toolCall paired with its result, an assistant text message (which ends a
 * turn), one `psych-appraisal` custom entry and one line that is not JSON at all.
 */
function fixtureLines(over = {}) {
  const prompt1 = over.prompt1 ?? "Fix npm test in src/shared/files.ts";
  return [
    json({ type: "session", version: 3, id: "sess", timestamp: iso(T0 - 1_000), cwd: "/p" }),
    json({ type: "message", id: "u1", parentId: null, timestamp: iso(T0), message: { role: "user", content: prompt1, timestamp: T0 } }),
    // The bash call: its command is the evidence; its result follows and pairs by toolCallId.
    json({
      type: "message",
      id: "a1",
      parentId: "u1",
      timestamp: iso(T0 + 1_000),
      message: { role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "bash", arguments: { command: "npm test" } }], timestamp: T0 + 1_000 },
    }),
    json({
      type: "message",
      id: "r1",
      parentId: "a1",
      timestamp: iso(T0 + 2_000),
      message: { role: "toolResult", toolCallId: "call_1", toolName: "bash", isError: false, content: [{ type: "text", text: "ok" }], timestamp: T0 + 2_000 },
    }),
    // An assistant message with only text ends the turn (the live observer emits a `turn` here).
    json({ type: "message", id: "a2", parentId: "r1", timestamp: iso(T0 + 3_000), message: { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: T0 + 3_000 } }),
    json({ type: "message", id: "u2", parentId: "a2", timestamp: iso(T0 + 4_000), message: { role: "user", content: "Now add tests", timestamp: T0 + 4_000 } }),
    json({ type: "custom", id: "c1", parentId: "u2", timestamp: iso(T0 + 5_000), customType: "psych-appraisal", data: { needs: { autonomy: { state: "met", cited: [] } } } }),
    "this line is not json and must be skipped silently",
  ];
}

test("a past session folds to the same observations the live observer would have produced", () => {
  const slice = readReplay(fixtureLines());
  assert.deepEqual(slice.observations, [
    { kind: "prompt", at: T0, text: "Fix npm test in src/shared/files.ts" },
    { kind: "tool", at: T0 + 2_000, toolName: "bash", command: "npm test", path: undefined, ok: true },
    { kind: "turn", at: T0 + 3_000 },
    { kind: "prompt", at: T0 + 4_000, text: "Now add tests" },
  ]);
});

test("the custom psych-appraisal entry is found, and unknown lines are skipped", () => {
  const slice = readReplay(fixtureLines());
  assert.equal(slice.appraisals.length, 1);
  assert.deepEqual(slice.appraisals[0], { needs: { autonomy: { state: "met", cited: [] } } });
  // The header is not a branch entry, and the unparsable line produced no entry.
  assert.ok(slice.entries.every((entry) => entry.type !== "session"));
});

test("a user message marked as extension-injected is not attributed to the operator", () => {
  const lines = fixtureLines().concat([
    json({ type: "message", id: "u3", parentId: "u2", timestamp: iso(T0 + 6_000), message: { role: "user", source: "extension", content: "[self-compact handoff]", timestamp: T0 + 6_000 } }),
  ]);
  const slice = readReplay(lines);
  assert.equal(slice.observations.filter((item) => item.kind === "prompt").length, 2);
  assert.ok(!slice.observations.some((item) => item.kind === "prompt" && item.text.includes("handoff")));
});

test("a tool call with no result yields no tool observation", () => {
  const lines = [
    json({ type: "message", id: "a1", parentId: null, timestamp: iso(T0), message: { role: "assistant", content: [{ type: "toolCall", id: "orphan", name: "edit", arguments: { path: "a.ts" } }], timestamp: T0 } }),
  ];
  const slice = readReplay(lines);
  assert.equal(slice.observations.filter((item) => item.kind === "tool").length, 0);
});

test("the log is cut at every cadenceTurns turn observation", () => {
  const observations = [
    { kind: "prompt", at: T0, text: "a" },
    { kind: "turn", at: T0 + 1 },
    { kind: "prompt", at: T0 + 2, text: "b" },
    { kind: "turn", at: T0 + 3 },
    { kind: "prompt", at: T0 + 4, text: "c" },
    { kind: "turn", at: T0 + 5 },
  ];
  const windows = sliceWindows(observations, [], { cadenceTurns: 2 });
  assert.equal(windows.length, 2, "a window every 2 turns, plus the trailing remainder");
  assert.equal(windows[0].observations.length, 4, "the first window ends at the 2nd turn");
  assert.equal(windows[1].observations.length, 6, "the trailing window carries the rest");
});

test("the replayed user text is byte-identical to buildUserText on the same lines", () => {
  const slice = readReplay(fixtureLines());
  const windows = sliceWindows(slice.observations, slice.entries, { cadenceTurns: 1 });
  assert.ok(windows.length > 0);
  for (const window of windows) {
    assert.equal(window.userText, buildUserText(window.liveLines, window.sessionLines));
  }
});

/** A fake filesystem + model seam for the command handler. */
function makeDeps(over = {}) {
  const files = new Map();
  const state = { modelCalls: 0 };
  const deps = {
    readFile: (path) => {
      if (!files.has(path)) throw new Error("ENOENT: no such file");
      return files.get(path);
    },
    writeFile: (path, text) => files.set(path, text),
    callModel: async () => {
      state.modelCalls += 1;
      return { ok: false, stage: "config", error: "not called in a test" };
    },
    ...over,
  };
  return { files, state, deps };
}

function ctxWith() {
  const ctx = makeCtx({ modelRegistry: {} });
  return ctx;
}

test("--dry (the default) folds windows and makes no model call", async () => {
  const { files, state, deps } = makeDeps();
  files.set("session.jsonl", fixtureLines().join("\n"));
  const handler = replayCommandHandler(makeState(), deps);
  const line = await handler(ctxWith(), "session.jsonl");
  assert.equal(line, "", "the report is notified, not returned as a status line");
  assert.equal(state.modelCalls, 0, "dry must not touch the model");
});

test("--json writes a result file that is re-readable", async () => {
  const { files, deps } = makeDeps();
  files.set("session.jsonl", fixtureLines().join("\n"));
  const handler = replayCommandHandler(makeState(), deps);
  await handler(ctxWith(), "session.jsonl --json out.json");
  const written = files.get("out.json");
  assert.ok(typeof written === "string", "the file was written");
  const parsed = JSON.parse(written);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.mode, "dry");
  assert.ok(Array.isArray(parsed.windows) && parsed.windows.length > 0);
  assert.equal(parsed.windows[0].windowIndex, 0);
});

test("the rendered report shows counts and verdicts, never the operator's prompt text", async () => {
  const { files, deps } = makeDeps();
  const prompt = "Fix npm test in src/shared/files.ts";
  files.set("session.jsonl", fixtureLines({ prompt1: prompt }).join("\n"));
  const ctx = ctxWith();
  await replayCommandHandler(makeState(), deps)(ctx, "session.jsonl");
  const report = ctx.notes.map((note) => note.message).join("\n");
  assert.ok(!report.includes(prompt), "the prompt body must never appear in the report");
  assert.ok(!report.includes("Now add tests"), "nor the second prompt");
  assert.match(report, /windows \d+/, "but the window count does");
});

test("a session file that cannot be read notifies with the path and the reason", async () => {
  const { deps } = makeDeps();
  const line = await replayCommandHandler(makeState(), deps)(ctxWith(), "missing.jsonl");
  assert.match(line, /missing\.jsonl/);
  assert.match(line, /ENOENT|no such file/);
});

test("the command needs the plugin enabled and a terminal UI", async () => {
  const { deps } = makeDeps();
  const off = makeState();
  off.config = { ...off.config, enabled: false };
  assert.match(await replayCommandHandler(off, deps)(ctxWith(), "x"), /off/i);
  const noUi = replayCommandHandler(makeState(), deps);
  assert.equal(await noUi(makeCtx({ hasUI: false }), "x"), stringsFor("en").notTui);
});

/** A run result with one valid citation and one that matches nothing. */
function mixedRun(windowIndex, responseText, interventionKind) {
  const evidence = ["window: 1 prompt(s), 0 tool call(s), 0 min"];
  const raw = {
    needs: { autonomy: { state: "met", cited: [evidence[0]] }, competence: { state: "unassessed", cited: [] }, relatedness: { state: "unassessed", cited: [] } },
    load: { level: "low", cited: ["a line that was never supplied"] },
    progress: { state: "unproven", cited: [] },
    flow: { state: "unassessed", cited: [] },
    interventions: interventionKind ? [{ kind: interventionKind, text: "do the next thing", cited: [evidence[0]] }] : [],
  };
  const parsed = parseAppraisal(JSON.stringify(raw), evidence);
  assert.ok(parsed.ok, "the fixture appraisal must parse");
  return {
    windowIndex,
    reasons: [],
    liveLines: evidence,
    sessionLines: [],
    responseText,
    enforcement: { appraisal: parsed.appraisal, unmatched: parsed.unmatched, downgraded: parsed.downgraded },
  };
}

test("a dropped claim shows citationRate < 1 and claims dropped 1", () => {
  const metrics = measureWindow(mixedRun(0, "one", undefined));
  assert.ok(metrics.citationRate < 1, "one of the two supplied citations was dropped");
  assert.equal(metrics.claimsDropped, 1);
  assert.equal(metrics.verdictsKept, 1, "the supported verdict survived");
});

test("two identical runs show changed: false", () => {
  const before = [mixedRun(0, "same", "name_next_win")];
  const after = [mixedRun(0, "same", "name_next_win")];
  const result = evaluateRuns(before, after);
  assert.equal(result.windows[0].changed, false);
  assert.equal(result.windows[0].kindBefore, "name_next_win");
  assert.equal(result.windows[0].kindAfter, "name_next_win");
});

test("a changed intervention kind is reported as before/after", () => {
  const before = [mixedRun(0, "a", "name_next_win")];
  const after = [mixedRun(0, "b", "reduce_load")];
  const result = evaluateRuns(before, after);
  assert.equal(result.windows[0].changed, true);
  assert.equal(result.windows[0].kindBefore, "name_next_win");
  assert.equal(result.windows[0].kindAfter, "reduce_load");
});

test("the eval aggregates over windows (precision, abstention, citations per finding)", () => {
  const before = [mixedRun(0, "a", "name_next_win"), mixedRun(1, "b", undefined)];
  const after = [mixedRun(0, "a", "name_next_win"), mixedRun(1, "b", "thin_slice")];
  const result = evaluateRuns(before, after);
  assert.equal(result.windows.length, 2);
  assert.ok(result.before.precision >= 0 && result.before.precision <= 1);
  assert.ok(result.after.meanCitationsPerFinding > 0, "two findings, so citations per finding is > 0");
  assert.equal(result.after.claimsDropped, 2, "each of the two windows dropped one claim");
});

test("every new replay string exists, non-empty, in both locales", () => {
  const keys = [
    "cmdReplay",
    "replayTitle",
    "replayHeader",
    "replayModeDry",
    "replayModeRun",
    "replayModel",
    "replayWindow",
    "replayTrigger",
    "replayNoTrigger",
    "replayEvidence",
    "replayEnforcement",
    "replayInterventionNone",
    "replayResponse",
    "replayFailures",
    "replayNoWindows",
    "replaySaved",
    "replayReadError",
    "replayWriteError",
    "replayNeedsFile",
    "replayEvalNeedsFiles",
    "replayEvalTitle",
    "replayEvalHeader",
    "replayEvalColumns",
    "replayMetrics",
    "replayWindowChange",
    "replayWindowUnchanged",
  ];
  for (const locale of ["en", "cs"]) {
    const s = stringsFor(locale);
    for (const key of keys) {
      assert.ok(s[key] !== undefined && s[key] !== null, `${locale}.${key} missing`);
      if (typeof s[key] === "string") assert.ok(s[key].length > 0, `${locale}.${key} empty`);
    }
  }
});

test("completions: replay is non-terminal, its leaves terminal, the default mode annotated", () => {
  const state = makeState();
  const top = completePsych(state, "");
  const replay = top.find((item) => item.label === "replay");
  assert.equal(replay.value, "replay ", "non-terminal: trailing space");
  assert.equal(replay.description, stringsFor("en").cmdReplay);

  const leaves = completePsych(state, "replay ");
  assert.deepEqual(
    leaves.map((item) => item.value),
    ["replay --run", "replay --dry", "replay --eval"],
  );
  for (const leaf of leaves) {
    assert.ok(!leaf.value.endsWith(" "), "a terminal leaf carries no trailing space: " + leaf.value);
  }
  const dry = leaves.find((item) => item.label.startsWith("dry"));
  assert.match(dry.label, /✓/, "the value in effect is ticked in the label");
  assert.match(dry.description, /●/, "and marked in the description");
  assert.ok(!dry.value.includes("✓"), "never in the inserted value");
});

test("--eval reads two result files and renders the table without a session or a model", async () => {
  const { files, state, deps } = makeDeps();
  files.set(
    "before.json",
    JSON.stringify({ version: 1, windows: [mixedRun(0, "a", "name_next_win"), mixedRun(1, "b", undefined)] }),
  );
  files.set("after.json", JSON.stringify({ version: 1, windows: [mixedRun(0, "a", "name_next_win"), mixedRun(1, "b", "thin_slice")] }));
  const ctx = ctxWith();
  const line = await replayCommandHandler(makeState(), deps)(ctx, "--eval before.json after.json");
  assert.equal(line, "");
  const report = ctx.notes.map((note) => note.message).join("\n");
  assert.match(report, /REPLAY EVAL/);
  assert.match(report, /citation rate/);
  assert.match(report, /name_next_win/);
  assert.equal(state.modelCalls, 0, "the eval is arithmetic, never a model call");
  // The eval needs no session file.
  assert.ok(!files.has("session.jsonl"));
});

test("a neutral window carries no fabricated verdicts", () => {
  const result = enforceEvidence(neutralAppraisal(), ["window: 1 prompt(s)"]);
  assert.equal(result.downgraded.length, 0);
  assert.equal(result.unmatched.length, 0);
});
