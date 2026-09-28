/**
 * Signal fold — the arithmetic the psychologist is allowed to trust.
 *
 * These tests assert numbers a human counted in the fixture, not numbers the
 * code produced. If the fold changes, a test must change on purpose.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SIGNAL_OPTIONS,
  describeSignals,
  extractSignals,
} from "../src/shared/signals.js";
import {
  classifyFailure,
  errorTextFromResult,
  isUnscoped,
  isVerificationCommand,
  overlap,
  tokenize,
} from "../src/shared/lexicon.js";
import { FIXTURE_EXPECTED, UNSCOPED_PROMPT, sessionFixture } from "./fakes.js";

test("a whole session folds to the counted fixture values", () => {
  const signals = extractSignals(sessionFixture(), { restatementThreshold: 0.6 });
  for (const [key, expected] of Object.entries(FIXTURE_EXPECTED)) {
    assert.deepEqual(signals[key], expected, `signal '${key}'`);
  }
});

test("median prompt length is the median of the observed prompts, not their mean", () => {
  const log = sessionFixture();
  const lengths = log
    .filter((item) => item.kind === "prompt")
    .map((item) => item.text.length)
    .sort((a, b) => a - b);
  const expected = lengths[1];
  assert.equal(extractSignals(log).medianPromptChars, expected);
});

test("an empty window is empty, not progress and not a problem", () => {
  const signals = extractSignals([]);
  assert.equal(signals.promptCount, 0);
  assert.equal(signals.toolCalls, 0);
  assert.equal(signals.toolFailureRate, 0);
  assert.equal(signals.verificationRuns, 0);
  assert.equal(signals.unverifiedWindow, false, "no turns ran, so nothing is unverified");
  assert.equal(signals.evidence.length, 1, "only the window line is emitted");
});

test("turns with no successful verification are flagged as an unverified window", () => {
  const log = [
    { kind: "prompt", at: 0, text: "do the thing" },
    { kind: "tool", at: 1, toolName: "bash", command: "npm test", ok: false },
    { kind: "turn", at: 2 },
    { kind: "turn", at: 3 },
  ];
  const signals = extractSignals(log);
  assert.equal(signals.unverifiedWindow, true);
  assert.equal(signals.verificationRuns, 0);
  assert.equal(signals.turnsSinceVerifiedProgress, 2);
  assert.match(signals.evidence.join("\n"), /verified progress: none/);
});

test("a failed verification run does not count as progress", () => {
  const onlyFailures = extractSignals([
    { kind: "tool", at: 1, toolName: "bash", command: "npm test", ok: false },
    { kind: "turn", at: 2 },
  ]);
  assert.equal(onlyFailures.verificationRuns, 0);
});

test("commands that cannot fail on the work are not progress", () => {
  for (const command of ["cat src/a.ts", "ls -la", "grep -n foo src/a.ts", "echo done"]) {
    assert.equal(isVerificationCommand(command), false, command);
  }
  const signals = extractSignals([
    { kind: "tool", at: 1, toolName: "bash", command: "cat src/a.ts", ok: true },
    { kind: "turn", at: 2 },
  ]);
  assert.equal(signals.verificationRuns, 0);
  assert.equal(signals.unverifiedWindow, true);
});

test("test, lint, typecheck and build runs are progress when they succeed", () => {
  for (const command of [
    "npm test",
    "npm run lint",
    "npx tsc --noEmit",
    "cargo test",
    "pytest -q",
    "node --test test/x.test.js",
    "make check",
  ]) {
    assert.equal(isVerificationCommand(command), true, command);
  }
});

test("a restatement is token overlap, not string equality", () => {
  const signals = extractSignals([
    { kind: "prompt", at: 0, text: "Please refactor the overlay frame so it clamps width" },
    { kind: "prompt", at: 1, text: "the overlay frame clamps width, please refactor" },
  ]);
  assert.equal(signals.restatedPrompts, 1);
});

test("unrelated prompts are not restatements", () => {
  const signals = extractSignals([
    { kind: "prompt", at: 0, text: "Add a width test to src/slices/overlay/layout.ts" },
    { kind: "prompt", at: 1, text: "Commit and push the repository" },
  ]);
  assert.equal(signals.restatedPrompts, 0);
});

test("overlap is a Jaccard ratio and 0 when either side is empty", () => {
  assert.equal(overlap([], ["a"]), 0);
  assert.equal(overlap(["a", "b"], ["a", "b"]), 1);
  assert.equal(overlap(["a", "b"], ["c", "d"]), 0);
  assert.equal(overlap(["a", "b", "c"], ["a", "b"]), 2 / 3);
});

test("tokenize drops short words and punctuation", () => {
  assert.deepEqual(tokenize("Fix npm test in src/shared/signals.ts"), [
    "fix",
    "npm",
    "test",
    "src",
    "shared",
    "signals",
  ]);
});

test("unscoped needs BOTH length and a missing anchor", () => {
  const long = `${UNSCOPED_PROMPT}`;
  assert.equal(isUnscoped(long), true, "long and anchor-free");
  // Same sentence, plus one concrete anchor: not reported as unscoped.
  assert.equal(isUnscoped(`${long} konkretne v src/shared/signals.ts`), false);
  // Anchor-free but short: not reported either.
  assert.equal(isUnscoped("znovu to nefunguje"), false);
});

test("idle gaps follow the configured threshold, not a hardcoded one", () => {
  const log = [
    { kind: "prompt", at: 0, text: "a" },
    { kind: "prompt", at: 60_000, text: "b" },
  ];
  assert.equal(extractSignals(log, { idleGapMs: 600_000 }).idleGaps, 0);
  assert.equal(extractSignals(log, { idleGapMs: 30_000 }).idleGaps, 1);
  const tight = extractSignals(log, { idleGapMs: 30_000 });
  assert.equal(tight.longestIdleGapMs, 60_000);
});

test("evidence quotes counts and never interprets", () => {
  const signals = extractSignals(sessionFixture());
  const text = signals.evidence.join("\n");
  assert.match(text, /tool failures: 3\/8 \(38%\)/);
  assert.match(text, /prompts restating an earlier prompt: 1/);
  assert.match(text, /prompts containing a correction marker: 1/);
  assert.match(text, /long prompts with no file, path, command or identifier: 1/);
  assert.match(text, /files mutated more than once: src\/shared\/signals\.ts/);
  assert.match(text, /pauses over 10 min: 1/);
  // The house rule: counts, never conclusions about the person or the agent.
  for (const word of ["struggl", "frustrat", "tired", "failing to", "should", "seems"]) {
    assert.ok(!text.toLowerCase().includes(word), `evidence must not interpret: '${word}'`);
  }
});

test("the window line is always present, so absence is readable as absence", () => {
  const lines = describeSignals(extractSignals([]), DEFAULT_SIGNAL_OPTIONS.idleGapMs);
  assert.deepEqual(lines, ["window: 0 prompt(s), 0 tool call(s), 0 min"]);
});
// --- failure fingerprints -------------------------------------------------
// The proof for this increment: one line per signature, not one per failure, and
// nothing from the raw error text — which carries code, arguments and absolute
// paths — ever reaches the evidence set.

test("an edit failing on oldText mismatch emits one fingerprint line, not one per failure, and leaks no path outside the basename", () => {
  const raw = 'oldText not found in D:/01_programovani/pi/plugins/pi-openrouter-accounts/src/accounts.ts';
  const log = [];
  for (let i = 0; i < 4; i += 1) {
    log.push({
      kind: "tool",
      at: 1000 + i,
      toolName: "edit",
      path: "D:/01_programovani/pi/plugins/pi-openrouter-accounts/src/accounts.ts",
      ok: false,
      errorSignature: classifyFailure(raw),
    });
  }

  const signals = extractSignals(log);
  const fingerprints = signals.evidence.filter((entry) => entry.includes("failed") && entry.includes("—"));

  assert.equal(fingerprints.length, 1, `expected one fingerprint line, got:\n${fingerprints.join("\n")}`);
  assert.equal(fingerprints[0], "edit failed 4x — oldText did not match");
  assert.equal(signals.failureFingerprints.length, 1);
  assert.equal(signals.failureFingerprints[0].count, 4);

  const evidence = signals.evidence.join("\n");
  assert.ok(!evidence.includes("01_programovani"), "a path fragment leaked into the evidence");
  assert.ok(!evidence.includes("accounts.ts"), "the raw path leaked into the evidence");
  // The aggregate line stays, so the two never disagree about how many failures there were.
  assert.ok(signals.evidence.some((entry) => entry.startsWith("tool failures: 4/4")), signals.evidence.join("\n"));
});

test("distinct signatures on one tool stay distinct lines", () => {
  const signals = extractSignals([
    { kind: "tool", at: 1, toolName: "edit", ok: false, errorSignature: "oldText did not match" },
    { kind: "tool", at: 2, toolName: "edit", ok: false, errorSignature: "oldText did not match" },
    { kind: "tool", at: 3, toolName: "bash", ok: false, errorSignature: "timed out" },
  ]);
  const fingerprints = signals.evidence.filter((entry) => entry.includes("—"));

  assert.deepEqual(fingerprints, [
    "edit failed 2x — oldText did not match",
    "bash failed 1x — timed out",
  ]);
});

test("a failure with no recognisable signature still counts, and says so", () => {
  const signals = extractSignals([
    { kind: "tool", at: 1, toolName: "weird_tool", ok: false, errorSignature: "unclassified failure" },
    { kind: "tool", at: 2, toolName: "weird_tool", ok: false },
  ]);

  assert.equal(signals.toolFailures, 2, "both failures still count");
  const fingerprints = signals.evidence.filter((entry) => entry.includes("—"));
  assert.deepEqual(fingerprints, ["weird_tool failed 2x — unclassified failure"]);
});

test("classifyFailure picks the fixed vocabulary and never echoes the raw text", () => {
  const cases = [
    ["Could not find the string to replace in file", "oldText did not match"],
    ["ENOENT: no such file or directory, open 'x/y.ts'", "file not found"],
    ["spawn EACCES", "permission denied"],
    ["Unknown tool: frobnicate", "tool not found"],
    ["language server failed to start", "language server error"],
    ["429 Too Many Requests", "rate limited"],
    ["something entirely novel happened", "unclassified failure"],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(classifyFailure(raw), expected, `for '${raw}'`);
  }
  assert.equal(classifyFailure(undefined), undefined);
  assert.equal(classifyFailure("   "), undefined);
  for (const [raw] of cases) {
    assert.ok(!String(classifyFailure(raw)).includes("ENOENT"), "raw error text reached the signature");
  }
});

test("errorTextFromResult reads the shapes the engine emits", () => {
  assert.equal(errorTextFromResult("boom"), "boom");
  assert.equal(errorTextFromResult({ error: "boom" }), "boom");
  assert.equal(errorTextFromResult({ output: "boom" }), "boom");
  assert.equal(errorTextFromResult({ content: [{ type: "text", text: "boom" }] }), "boom");
  assert.equal(errorTextFromResult({}), undefined);
  assert.equal(errorTextFromResult(null), undefined);
  assert.equal(errorTextFromResult(42), undefined);
});

// --- recurring friction as a first-class line (T18) -----------------------
// "The same thing keeps failing" is a different fact from "a thing failed N times", so it ships
// as its own line kind, capped so a noisy session cannot bury the rest of the evidence.

test("3 identical bash failures plus 1 different produce exactly one recurring line, ×3", () => {
  const log = [
    { kind: "tool", at: 1, toolName: "bash", ok: false, errorSignature: "timed out" },
    { kind: "tool", at: 2, toolName: "bash", ok: false, errorSignature: "timed out" },
    { kind: "tool", at: 3, toolName: "bash", ok: false, errorSignature: "timed out" },
    { kind: "tool", at: 4, toolName: "bash", ok: false, errorSignature: "file not found" },
  ];
  const recurring = extractSignals(log).evidence.filter((line) => line.startsWith("recurring failure:"));
  assert.deepEqual(recurring, ["recurring failure: bash · timed out ×3"]);
});

test("a fingerprint seen only once is not recurring, and the list is highest count first, capped at 3", () => {
  const single = extractSignals([
    { kind: "tool", at: 1, toolName: "edit", ok: false, errorSignature: "oldText did not match" },
  ]);
  assert.deepEqual(single.evidence.filter((line) => line.startsWith("recurring failure:")), []);

  const log = [];
  const push = (tool, signature, n) => {
    for (let i = 0; i < n; i += 1) log.push({ kind: "tool", at: 100 + log.length, toolName: tool, ok: false, errorSignature: signature });
  };
  push("bash", "a", 5);
  push("edit", "b", 4);
  push("write", "c", 3);
  push("read", "d", 2);
  const recurring = extractSignals(log).evidence.filter((line) => line.startsWith("recurring failure:"));
  assert.deepEqual(recurring, [
    "recurring failure: bash · a ×5",
    "recurring failure: edit · b ×4",
    "recurring failure: write · c ×3",
  ]);
});

// --- the two counters the trigger rule added to the fold (T14) ------------

test("failureStreak counts trailing failures and stops at the last success", () => {
  const allFailures = [
    { kind: "tool", at: 1, toolName: "bash", ok: false },
    { kind: "tool", at: 2, toolName: "bash", ok: false },
    { kind: "tool", at: 3, toolName: "bash", ok: false },
  ];
  assert.equal(extractSignals(allFailures).failureStreak, 3);
  const brokenTail = [
    { kind: "tool", at: 1, toolName: "bash", ok: false },
    { kind: "tool", at: 2, toolName: "bash", ok: true },
    { kind: "tool", at: 3, toolName: "bash", ok: false },
  ];
  assert.equal(extractSignals(brokenTail).failureStreak, 1);
  assert.equal(extractSignals([]).failureStreak, 0);
});

test("deliveredRuns counts a verified run only after a real change set", () => {
  const edits = [];
  for (let i = 0; i < 4; i += 1) edits.push({ kind: "tool", at: i, toolName: "edit", path: "a.ts", ok: true });
  const verified = { kind: "tool", at: 10, toolName: "bash", command: "npm test", ok: true };
  assert.equal(extractSignals([...edits, verified]).deliveredRuns, 1);
  // Three mutations, not four: activity that proved itself is not a delivery.
  assert.equal(extractSignals([...edits.slice(0, 3), verified]).deliveredRuns, 0);
  assert.equal(extractSignals([verified]).deliveredRuns, 0);
});
