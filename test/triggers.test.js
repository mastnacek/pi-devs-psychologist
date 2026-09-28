/**
 * Triggers — the rule that replaced the clock (T14).
 *
 * Every reason is asserted in isolation, and every one is also asserted *not* to fire against a
 * baseline that already saw it. That second assertion is the whole point of the module: a trigger
 * that re-fires on evidence it has already appraised is a clock wearing a delta's clothes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TRIGGER_THRESHOLDS,
  EMPTY_TRIGGER_BASELINE,
  evaluateTriggers,
  fingerprintKey,
  snapshotTriggers,
} from "../src/shared/triggers.js";

/** A full SessionSignals with only the fields the triggers read; the rest stay zero. */
function signals(over = {}) {
  return {
    failureStreak: 0,
    deliveredRuns: 0,
    restatedPrompts: 0,
    turnsSinceVerifiedProgress: 0,
    failureFingerprints: [],
    unverifiedCommits: 0,
    ...over,
  };
}

/** A full SessionHistory with only the fields the triggers read. */
function history(over = {}) {
  return { abortedTurns: 0, compactions: 0, thinkingRaises: 0, ...over };
}

function input(s = {}, h = {}) {
  return { signals: signals(s), history: history(h) };
}

/** The reasons the current evidence raises against a baseline, with the default thresholds. */
function reasons(s = {}, h = {}, baseline = EMPTY_TRIGGER_BASELINE) {
  return evaluateTriggers(input(s, h), baseline, DEFAULT_TRIGGER_THRESHOLDS).reasons;
}

test("nothing new means no trigger, so a healthy turn costs nothing", () => {
  const result = evaluateTriggers(input(), EMPTY_TRIGGER_BASELINE, DEFAULT_TRIGGER_THRESHOLDS);
  assert.deepEqual(result, { fire: false, reasons: [] });
});

test("failure_streak fires at the threshold, and only while it is growing", () => {
  assert.deepEqual(reasons({ failureStreak: 2 }), [], "below the threshold");
  assert.deepEqual(reasons({ failureStreak: 3 }), ["failure_streak"]);
  // Already seen at 3: the same streak must not fire again.
  assert.deepEqual(reasons({ failureStreak: 3 }, {}, { ...EMPTY_TRIGGER_BASELINE, failureStreak: 3 }), []);
  // But a longer streak is new evidence.
  assert.deepEqual(reasons({ failureStreak: 4 }, {}, { ...EMPTY_TRIGGER_BASELINE, failureStreak: 3 }), [
    "failure_streak",
  ]);
});

test("recurring_failure fires when one fingerprint's count grows past the threshold", () => {
  const fp = [{ toolName: "bash", signature: "timed out", count: 2 }];
  assert.deepEqual(reasons({ failureFingerprints: fp }), ["recurring_failure"]);
  // Count 1 is a one-off, not a recurrence.
  assert.deepEqual(reasons({ failureFingerprints: [{ ...fp[0], count: 1 }] }), []);
  // Already snapshotted at 2: no fire until it grows.
  const baseline = { ...EMPTY_TRIGGER_BASELINE, fingerprints: { [fingerprintKey("bash", "timed out")]: 2 } };
  assert.deepEqual(reasons({ failureFingerprints: fp }, {}, baseline), []);
  assert.deepEqual(reasons({ failureFingerprints: [{ ...fp[0], count: 3 }] }, {}, baseline), [
    "recurring_failure",
  ]);
});

test("restatement fires on a new restatement, not on the running total", () => {
  assert.deepEqual(reasons({ restatedPrompts: 1 }), ["restatement"]);
  assert.deepEqual(reasons({ restatedPrompts: 3 }, {}, { ...EMPTY_TRIGGER_BASELINE, restatedPrompts: 3 }), []);
  assert.deepEqual(reasons({ restatedPrompts: 4 }, {}, { ...EMPTY_TRIGGER_BASELINE, restatedPrompts: 3 }), [
    "restatement",
  ]);
});

test("operator_abort fires on a new cancelled turn", () => {
  assert.deepEqual(reasons({}, { abortedTurns: 1 }), ["operator_abort"]);
  assert.deepEqual(reasons({}, { abortedTurns: 1 }, { ...EMPTY_TRIGGER_BASELINE, abortedTurns: 1 }), []);
});

test("stale_progress fires on the crossing, once", () => {
  assert.deepEqual(reasons({ turnsSinceVerifiedProgress: 5 }), [], "not yet at the threshold");
  assert.deepEqual(reasons({ turnsSinceVerifiedProgress: 6 }), ["stale_progress"]);
  // The baseline at 6 means the crossing already happened; 7 is not a new crossing.
  assert.deepEqual(
    reasons({ turnsSinceVerifiedProgress: 7 }, {}, { ...EMPTY_TRIGGER_BASELINE, turnsSinceVerifiedProgress: 6 }),
    [],
  );
});

test("compaction and thinking_raised fire on new operator events", () => {
  assert.deepEqual(reasons({}, { compactions: 1 }), ["compaction"]);
  assert.deepEqual(reasons({}, { compactions: 1 }, { ...EMPTY_TRIGGER_BASELINE, compactions: 1 }), []);
  assert.deepEqual(reasons({}, { thinkingRaises: 1 }), ["thinking_raised"]);
  assert.deepEqual(reasons({}, { thinkingRaises: 1 }, { ...EMPTY_TRIGGER_BASELINE, thinkingRaises: 1 }), []);
});

test("delivered fires on a new closed loop", () => {
  assert.deepEqual(reasons({ deliveredRuns: 1 }), ["delivered"]);
  assert.deepEqual(reasons({ deliveredRuns: 1 }, {}, { ...EMPTY_TRIGGER_BASELINE, deliveredRuns: 1 }), []);
});

test("commit_unverified fires on a new unverified commit, and never twice for the same one", () => {
  assert.deepEqual(reasons({ unverifiedCommits: 1 }), ["commit_unverified"]);
  // The baseline already saw one commit: the same one must not fire again.
  assert.deepEqual(
    reasons({ unverifiedCommits: 1 }, {}, { ...EMPTY_TRIGGER_BASELINE, unverifiedCommits: 1 }),
    [],
  );
  // A second unverified commit is new evidence.
  assert.deepEqual(
    reasons({ unverifiedCommits: 2 }, {}, { ...EMPTY_TRIGGER_BASELINE, unverifiedCommits: 1 }),
    ["commit_unverified"],
  );
});

test("several reasons can fire together, and all are named", () => {
  const result = evaluateTriggers(
    input({ failureStreak: 3, restatedPrompts: 1 }, { abortedTurns: 1 }),
    EMPTY_TRIGGER_BASELINE,
    DEFAULT_TRIGGER_THRESHOLDS,
  );
  assert.equal(result.fire, true);
  assert.deepEqual(result.reasons, ["failure_streak", "restatement", "operator_abort"]);
});

test("a snapshot captures every counter, keyed by tool and signature", () => {
  const baseline = snapshotTriggers(
    input(
      { failureStreak: 4, deliveredRuns: 2, restatedPrompts: 1, turnsSinceVerifiedProgress: 7, failureFingerprints: [
        { toolName: "bash", signature: "timed out", count: 3 },
        { toolName: "edit", signature: "oldText did not match", count: 2 },
      ] },
      { abortedTurns: 1, compactions: 1, thinkingRaises: 2 },
    ),
  );
  assert.equal(baseline.failureStreak, 4);
  assert.equal(baseline.deliveredRuns, 2);
  assert.equal(baseline.restatedPrompts, 1);
  assert.equal(baseline.turnsSinceVerifiedProgress, 7);
  assert.equal(baseline.abortedTurns, 1);
  assert.equal(baseline.compactions, 1);
  assert.equal(baseline.thinkingRaises, 2);
  assert.deepEqual(baseline.fingerprints, {
    [fingerprintKey("bash", "timed out")]: 3,
    [fingerprintKey("edit", "oldText did not match")]: 2,
  });
});

test("snapshotting and then re-evaluating the same evidence fires nothing", () => {
  const current = input({ failureStreak: 3, restatedPrompts: 1 }, { abortedTurns: 1 });
  const baseline = snapshotTriggers(current);
  assert.deepEqual(evaluateTriggers(current, baseline, DEFAULT_TRIGGER_THRESHOLDS), {
    fire: false,
    reasons: [],
  });
});
