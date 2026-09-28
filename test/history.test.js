/**
 * Session history — the structural record, folded from real entry shapes.
 *
 * The fixture is a hand-built session whose every count a human can tally, and
 * the evidence array is asserted *exactly*, so a line that starts interpreting
 * instead of counting fails the suite rather than shipping.
 *
 * Entry shapes come from the engine's own documented session format
 * (docs/session-format.md): `message` timestamps are ms, entry timestamps are ISO.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { THINKING_ORDER, foldHistory, readHistory } from "../src/shared/history.js";
import { describeHistory } from "../src/shared/history-evidence.js";

const T0 = 1_700_000_000_000;
const iso = (offset) => new Date(T0 + offset).toISOString();

let seq = 0;
function entry(over = {}) {
  seq += 1;
  return {
    id: `e${seq}`,
    parentId: seq === 1 ? null : `e${seq - 1}`,
    ...over,
  };
}

function user(offset, text = "go") {
  return entry({ type: "message", timestamp: iso(offset), message: { role: "user", content: text, timestamp: T0 + offset } });
}

function assistant(offset, over = {}) {
  return entry({
    type: "message",
    timestamp: iso(offset),
    message: {
      role: "assistant",
      content: [],
      stopReason: "stop",
      timestamp: T0 + offset,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
      ...over,
    },
  });
}

/** A session with counted properties. Update `EXPECTED` when you edit it. */
function sessionFixture() {
  seq = 0;
  return [
    entry({ type: "session_info", timestamp: iso(0), name: "Refactor auth module" }),
    user(10_000),
    assistant(12_000, {
      stopReason: "toolUse",
      usage: { input: 200, output: 0, cacheRead: 800, cacheWrite: 0, totalTokens: 1000, cost: {} },
    }),
    user(20_000),
    assistant(80_000, { stopReason: "aborted" }),
    entry({ type: "model_change", timestamp: iso(90_000), provider: "openai", modelId: "gpt-4o" }),
    entry({ type: "thinking_level_change", timestamp: iso(91_000), thinkingLevel: "medium" }),
    entry({ type: "thinking_level_change", timestamp: iso(92_000), thinkingLevel: "high" }),
    entry({ type: "thinking_level_change", timestamp: iso(93_000), thinkingLevel: "low" }),
    entry({ type: "compaction", timestamp: iso(100_000), summary: "s", firstKeptEntryId: "e1", tokensBefore: 50_000 }),
    entry({ type: "compaction", timestamp: iso(110_000), summary: "s", firstKeptEntryId: "e1", tokensBefore: 30_000, fromHook: true }),
    entry({ type: "branch_summary", timestamp: iso(120_000), fromId: "e2", summary: "abandoned" }),
    entry({ type: "context_edit", timestamp: iso(130_000), targetId: "e2", replacement: null }),
    entry({ type: "context_edit", timestamp: iso(131_000), targetId: "e3", replacement: { content: "rewritten" } }),
    entry({ type: "label", timestamp: iso(140_000), targetId: "e2", label: "checkpoint-1" }),
    entry({ type: "label", timestamp: iso(141_000), targetId: "e3", label: "checkpoint-2" }),
    entry({ type: "label", timestamp: iso(142_000), targetId: "e3", label: undefined }),
    // Cache-warming usage must not move the hit rate.
    entry({
      type: "usage",
      timestamp: iso(143_000),
      kind: "cache_warm",
      provider: "openai",
      model: "gpt-4o",
      usage: { input: 0, output: 0, cacheRead: 999_999, cacheWrite: 0, totalTokens: 999_999, cost: {} },
    }),
    user(150_000),
    assistant(151_000, { stopReason: "error" }),
    user(160_000),
    assistant(190_000, { stopReason: "length" }),
  ];
}

const EXPECTED = {
  windowMs: 190_000,
  declaredIntent: "Refactor auth module",
  modelsUsed: ["openai/gpt-4o"],
  modelSwitches: 1,
  thinkingRaises: 1,
  thinkingLowers: 1,
  abortedTurns: 1,
  errorTurns: 1,
  truncatedTurns: 1,
  compactions: 2,
  engineCompactions: 1,
  peakTokensBeforeCompaction: 50_000,
  abandonedBranches: 1,
  contextRemovals: 1,
  contextReplacements: 1,
  userCheckpoints: ["checkpoint-1"],
  medianHumanWaitMs: 16_000,
  longestHumanWaitMs: 60_000,
  cacheHitRate: 0.8,
};

const EXPECTED_EVIDENCE = [
  "session span: 3 min",
  'operator declared this session as: "Refactor auth module"',
  "turns the operator cancelled: 1",
  "turns ending in a provider error: 1",
  "turns cut off by the output limit: 1",
  "model switched 1 time(s), ending on: openai/gpt-4o",
  "thinking level raised by the operator: 1",
  "thinking level lowered by the operator: 1",
  "context compacted: 2 time(s), largest 50000 tokens (engine-decided: 1)",
  "approaches abandoned via /tree: 1",
  "earlier entries removed from model context: 1",
  "earlier entries rewritten in model context: 1",
  "operator bookmarks still set: 1 (checkpoint-1)",
  "wait for the agent: median 16 s, longest 60 s",
  "prompt-cache read share: 80%",
];

test("the fixture folds to the counted values", () => {
  const history = foldHistory(sessionFixture());
  for (const [key, expected] of Object.entries(EXPECTED)) {
    assert.deepEqual(history[key], expected, `history.${key}`);
  }
});

test("the evidence lines are exactly the counted facts, in order", () => {
  assert.deepEqual(foldHistory(sessionFixture()).evidence, EXPECTED_EVIDENCE);
});

test("the evidence never interprets", () => {
  const text = foldHistory(sessionFixture()).evidence.join("\n").toLowerCase();
  for (const word of ["struggl", "frustrat", "tired", "burn", "should", "seems", "overwhelm", "struggle"]) {
    assert.ok(!text.includes(word), `history evidence must not interpret: '${word}'`);
  }
});

test("turns the operator cancelled are read from stopReason, not guessed", () => {
  const history = foldHistory([
    entry({ type: "message", timestamp: iso(0), message: { role: "assistant", stopReason: "aborted", timestamp: T0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} } } }),
    entry({ type: "message", timestamp: iso(1), message: { role: "assistant", stopReason: "stop", timestamp: T0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} } } }),
  ]);
  assert.equal(history.abortedTurns, 1);
  assert.equal(history.errorTurns, 0);
  assert.equal(history.truncatedTurns, 0);
});

test("a burst of user messages does not restart the wait clock", () => {
  const history = foldHistory([
    user(0),
    user(5_000),
    user(9_000),
    assistant(60_000),
  ]);
  // The wait is measured from the first message of the burst, so a long wait
  // cannot be hidden by queueing more prompts into it.
  assert.equal(history.longestHumanWaitMs, 60_000);
  assert.equal(history.medianHumanWaitMs, 60_000);
});

test("thinking level direction uses the documented order and ignores unknown levels", () => {
  assert.deepEqual(THINKING_ORDER, ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  const history = foldHistory([
    entry({ type: "thinking_level_change", timestamp: iso(0), thinkingLevel: "low" }),
    entry({ type: "thinking_level_change", timestamp: iso(1), thinkingLevel: "gigantic" }),
    entry({ type: "thinking_level_change", timestamp: iso(2), thinkingLevel: "high" }),
  ]);
  assert.equal(history.thinkingRaises, 1, "unknown level is neither a raise nor a lower");
  assert.equal(history.thinkingLowers, 0);
});

test("a compaction is attributed to the engine unless an extension triggered it", () => {
  const history = foldHistory([
    entry({ type: "compaction", timestamp: iso(0), summary: "s", firstKeptEntryId: "x", tokensBefore: 10 }),
    entry({ type: "compaction", timestamp: iso(1), summary: "s", firstKeptEntryId: "x", tokensBefore: 10, fromHook: false }),
    entry({ type: "compaction", timestamp: iso(2), summary: "s", firstKeptEntryId: "x", tokensBefore: 10, fromHook: true }),
  ]);
  assert.equal(history.compactions, 3);
  assert.equal(history.engineCompactions, 2);
  assert.equal(history.peakTokensBeforeCompaction, 10);
});

test("a cleared label is a label the operator took back", () => {
  const history = foldHistory([
    entry({ type: "label", timestamp: iso(0), targetId: "a", label: "keep" }),
    entry({ type: "label", timestamp: iso(1), targetId: "b", label: "drop" }),
    entry({ type: "label", timestamp: iso(2), targetId: "b", label: undefined }),
  ]);
  assert.deepEqual(history.userCheckpoints, ["keep"]);
});

test("context edits are split into removals and rewrites", () => {
  const history = foldHistory([
    entry({ type: "context_edit", timestamp: iso(0), targetId: "a", replacement: null }),
    entry({ type: "context_edit", timestamp: iso(1), targetId: "b", replacement: { content: "" } }),
    entry({ type: "context_edit", timestamp: iso(2), targetId: "c", replacement: null }),
  ]);
  assert.equal(history.contextRemovals, 2);
  assert.equal(history.contextReplacements, 1);
});

test("tool-result usage counts toward the cache ratio", () => {
  const withToolResult = foldHistory([
    entry({
      type: "message",
      timestamp: iso(0),
      message: { role: "assistant", stopReason: "stop", timestamp: T0, usage: { input: 100, output: 0, cacheRead: 300, cacheWrite: 0, totalTokens: 400, cost: {} } },
    }),
    entry({
      type: "message",
      timestamp: iso(1),
      message: { role: "toolResult", toolCallId: "c", toolName: "bash", content: [], isError: false, usage: { input: 0, output: 0, cacheRead: 100, cacheWrite: 0, totalTokens: 100, cost: {} } },
    }),
  ]);
  // 400 cached of 500 prompt tokens.
  assert.equal(withToolResult.cacheHitRate, 0.8);
});

test("an empty branch is empty and reports no cache figure", () => {
  const history = foldHistory([]);
  assert.deepEqual(history.evidence, []);
  assert.equal(history.cacheHitRate, undefined);
  assert.equal(history.windowMs, 0);
  assert.equal(history.startedAt, undefined);
  assert.deepEqual(history.userCheckpoints, []);
});

test("unknown entry types and malformed timestamps are ignored, not fatal", () => {
  const history = foldHistory([
    entry({ type: "something_new_from_a_future_engine", timestamp: iso(0) }),
    entry({ type: "session_info", timestamp: "not-a-date", name: "named" }),
  ]);
  assert.equal(history.declaredIntent, "named");
  // The one valid timestamp is still the session start; the malformed one is
  // dropped rather than measured, and a lone timestamp spans no time.
  assert.equal(history.startedAt, T0);
  assert.equal(history.lastAt, T0);
  assert.equal(history.windowMs, 0);
});

test("readHistory reads the branch, not every entry in the session file", () => {
  const branch = sessionFixture();
  let branchCalls = 0;
  const ctx = {
    sessionManager: {
      getBranch() {
        branchCalls += 1;
        return branch;
      },
      getEntries() {
        throw new Error("getEntries() must not be used: it ignores /tree navigation");
      },
    },
  };
  assert.equal(readHistory(ctx).abortedTurns, 1);
  assert.equal(branchCalls, 1);
});

test("describeHistory is pure: it does not mutate the history it is given", () => {
  const history = foldHistory(sessionFixture());
  const before = JSON.stringify(history.evidence);
  describeHistory(history);
  assert.equal(JSON.stringify(history.evidence), before);
});