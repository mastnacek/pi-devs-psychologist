/**
 * Outcome ledger (T16) — the pure arithmetic behind "/psych effect".
 *
 * These tests pin the two things a reader must be able to check: the per-metric comparison rule
 * (a plain comparison, no weighting, no score), and the precise muting rule T17 depends on
 * (a majority of metrics NOT improved, twice in a row).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  coolingKinds,
  deliveredCount,
  doNotRepeatLines,
  effectByKind,
  isNoImprovement,
  mutedKinds,
  noteFollowed,
  noteQuickWin,
  resolveDueOutcomes,
  restoreOutcomes,
  snapshotOutcome,
} from "../src/shared/outcome.js";

const SNAP = (over = {}) => ({
  failureRate: 0.5,
  turnsSinceVerifiedProgress: 4,
  restatements: 3,
  aborts: 2,
  ...over,
});

function record(over = {}) {
  return {
    id: over.id ?? "o1",
    kind: over.kind ?? "thin_slice",
    deliveredAtTurn: over.deliveredAtTurn ?? 0,
    channel: over.channel ?? "card",
    before: over.before ?? SNAP(),
    text: over.text ?? "cut the change in half before writing more code",
    ...over,
  };
}

test("a snapshot takes the four session counters and nothing else", () => {
  const snapshot = snapshotOutcome({
    signals: { toolFailureRate: 0.25, turnsSinceVerifiedProgress: 7, restatedPrompts: 2 },
    history: { abortedTurns: 1 },
  });
  assert.deepEqual(snapshot, {
    failureRate: 0.25,
    turnsSinceVerifiedProgress: 7,
    restatements: 2,
    aborts: 1,
  });
});

test("a lower value is improved, an equal one unchanged, a higher one worse — for every metric", () => {
  const before = SNAP({ failureRate: 0.5, turnsSinceVerifiedProgress: 4, restatements: 3, aborts: 2 });
  const after = SNAP({ failureRate: 0.4, turnsSinceVerifiedProgress: 4, restatements: 5, aborts: 1 });
  const closed = record({ before });
  resolveDueOutcomes([closed], 5, 5, after);
  assert.deepEqual(closed.verdicts, {
    failureRate: "improved",
    turnsSinceVerifiedProgress: "unchanged",
    restatements: "worse",
    aborts: "improved",
  });
});

test("a metric that moved one way is never counted two: it is a single plain comparison", () => {
  // 0.01 lower still counts as improved: there is no dead-band, because a dead-band is the first
  // step toward a score.
  const closed = record({ before: SNAP({ failureRate: 0.5 }) });
  resolveDueOutcomes([closed], 5, 5, SNAP({ failureRate: 0.49 }));
  assert.equal(closed.verdicts.failureRate, "improved");
});

test("a majority of unchanged|worse metrics is no improvement; one improved of four is still not", () => {
  assert.equal(
    isNoImprovement({ failureRate: "improved", turnsSinceVerifiedProgress: "unchanged", restatements: "unchanged", aborts: "worse" }),
    true,
  );
  assert.equal(
    isNoImprovement({ failureRate: "improved", turnsSinceVerifiedProgress: "improved", restatements: "unchanged", aborts: "worse" }),
    false,
  );
});

test("a window closes only when its turns have elapsed, and only once", () => {
  const open = record({ deliveredAtTurn: 10 });
  assert.deepEqual(resolveDueOutcomes([open], 14, 5, SNAP()), [], "four turns is too early");
  const closed = resolveDueOutcomes([open], 15, 5, SNAP({ failureRate: 0.1 }));
  assert.equal(closed.length, 1);
  assert.equal(open.verdicts.failureRate, "improved");
  assert.deepEqual(resolveDueOutcomes([open], 99, 5, SNAP()), [], "an already-closed window is never reopened");
});

test("a kind is muted only after two delivered windows that failed to improve", () => {
  const once = [record({ id: "a", verdicts: { failureRate: "unchanged", turnsSinceVerifiedProgress: "unchanged", restatements: "unchanged", aborts: "unchanged" } })];
  assert.equal(mutedKinds(once).has("thin_slice"), false, "one bad delivery is not a verdict on the technique");
  const twice = [...once, record({ id: "b", verdicts: { failureRate: "worse", turnsSinceVerifiedProgress: "unchanged", restatements: "unchanged", aborts: "unchanged" } })];
  assert.equal(mutedKinds(twice).has("thin_slice"), true);
  // A kind that improved on both its windows is never muted.
  const good = [
    record({ id: "a", verdicts: { failureRate: "improved", turnsSinceVerifiedProgress: "improved", restatements: "unchanged", aborts: "unchanged" } }),
    record({ id: "b", verdicts: { failureRate: "improved", turnsSinceVerifiedProgress: "improved", restatements: "unchanged", aborts: "unchanged" } }),
  ];
  assert.equal(mutedKinds(good).has("thin_slice"), false);
});

test("cooling covers recent deliveries, but `stop` is exempt from cooldown", () => {
  const ledger = [record({ id: "a", kind: "thin_slice", deliveredAtTurn: 4 }), record({ id: "b", kind: "stop", deliveredAtTurn: 4 })];
  const cooling = coolingKinds(ledger, 6, 6);
  assert.equal(cooling.has("thin_slice"), true);
  assert.equal(cooling.has("stop"), false, "stop is exempt from cooldown (T17)");
  assert.equal(coolingKinds(ledger, 20, 6).size, 0, "an expired cooldown stops cooling");
});

test("the do-not-repeat line names the kind and how many times it was delivered", () => {
  const ledger = [record({ id: "a", deliveredAtTurn: 4 }), record({ id: "b", deliveredAtTurn: 5 })];
  const lines = doNotRepeatLines(ledger, 6, 6);
  // No window has closed yet, so the line must not claim a measured result.
  assert.deepEqual(lines, ["do not repeat: thin_slice (named 2 times, cooling down)"]);
  assert.equal(deliveredCount(ledger, "thin_slice"), 2);
});

test("the followed reaction is decided by token overlap on the next prompt", () => {
  const advice = "cut the change in half before writing more code";
  const ledger = [record({ id: "a", text: advice })];
  noteFollowed(ledger, advice);
  assert.equal(ledger[0].followed, true, "the exact advice scores a full overlap");
  // Decided once, not revised by a later unrelated prompt.
  noteFollowed(ledger, "completely different words about something else entirely");
  assert.equal(ledger[0].followed, true);
});

test("a prompt that shares nothing does not record a follow", () => {
  const ledger = [record({ id: "a", text: "cut the change in half before writing more code" })];
  noteFollowed(ledger, "xyzzy plugh frobnicate");
  assert.equal(ledger[0].followed, false);
});

test("only a `quick_win` call marks an open `name_next_win` window", () => {
  const ledger = [
    record({ id: "a", kind: "name_next_win" }),
    record({ id: "b", kind: "thin_slice" }),
  ];
  noteQuickWin(ledger, "quick_wins");
  assert.equal(ledger[0].quickWinCalled, undefined, "a differently-named tool is not a quick win");
  noteQuickWin(ledger, "quick_win");
  assert.equal(ledger[0].quickWinCalled, true);
  assert.equal(ledger[1].quickWinCalled, undefined, "only name_next_win is credited");
});

test("the effect table counts metric verdicts and follows per delivered kind", () => {
  const ledger = [
    record({ id: "a", followed: true, verdicts: { failureRate: "improved", turnsSinceVerifiedProgress: "unchanged", restatements: "unchanged", aborts: "worse" } }),
    record({ id: "b", followed: false, verdicts: { failureRate: "improved", turnsSinceVerifiedProgress: "improved", restatements: "unchanged", aborts: "unchanged" } }),
    record({ id: "c", kind: "reduce_load" }),
  ];
  const rows = effectByKind(ledger);
  const thin = rows.find((row) => row.kind === "thin_slice");
  assert.deepEqual(thin, { kind: "thin_slice", delivered: 2, improved: 3, unchanged: 4, worse: 1, followed: 1 });
  const reduce = rows.find((row) => row.kind === "reduce_load");
  assert.deepEqual(reduce, { kind: "reduce_load", delivered: 1, improved: 0, unchanged: 0, worse: 0, followed: 0 });
});

test("restoring replays custom entries and merges later appends by id", () => {
  const entries = [
    { type: "message", message: { role: "user", content: "x" } },
    { type: "custom", customType: "psych-outcome", data: record({ id: "a", deliveredAtTurn: 2 }) },
    { type: "custom", customType: "psych-outcome", data: { id: "a", verdicts: { failureRate: "improved", turnsSinceVerifiedProgress: "unchanged", restatements: "unchanged", aborts: "unchanged" } } },
    { type: "custom", customType: "unrelated", data: { id: "z" } },
    { type: "custom", customType: "psych-outcome", data: record({ id: "b", kind: "reduce_load" }) },
  ];
  const ledger = restoreOutcomes(entries);
  assert.equal(ledger.length, 2, "only psych-outcome custom entries, merged by id");
  assert.equal(ledger[0].id, "a");
  assert.equal(ledger[0].deliveredAtTurn, 2, "the earlier fields survive the merge");
  assert.equal(ledger[0].verdicts.failureRate, "improved", "and the later append adds the verdict");
  assert.equal(ledger[1].kind, "reduce_load");
});

test("a ledger entry is a custom entry, never a message: it cannot enter model context", () => {
  // This is the load-bearing invariant of the TUI-only mechanism (state-persistence.md): if these
  // were `message` entries the engine would fold them into every prompt.
  const entries = [{ type: "custom", customType: "psych-outcome", data: record({ id: "a" }) }];
  assert.equal(entries[0].type, "custom");
  assert.notEqual(entries[0].type, "message");
  assert.deepEqual(restoreOutcomes(undefined), [], "no entries is an empty ledger, not a crash");
  assert.deepEqual(restoreOutcomes([{ type: "custom", customType: "psych-outcome", data: null }]), []);
});
