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