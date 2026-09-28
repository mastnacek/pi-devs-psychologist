/**
 * Signal-triggered appraisal (T14) — the policy end to end.
 *
 * The unit rule lives in `triggers.test.js`; this file proves the appraiser actually consults it:
 * a healthy stretch spends nothing, a streak spends exactly once, the reason is citable evidence,
 * and a clockless silence is a named skip rather than a mystery.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { maybeAppraise } from "../src/slices/appraiser/index.js";
import { renderReport } from "../src/slices/report/index.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

const WINDOW_LINE = "window: 0 prompt(s), 0 tool call(s), 0 min";
const SESSION_LINE = "session span: 3 min";

/** State configured for the evidence rule, with the floor and a model. */
function triggerState(over = {}) {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, model: "openrouter-soukr/some/model", trigger: "signals", ...over };
  return state;
}

function makeDeps(over = {}) {
  const calls = [];
  return {
    calls,
    readHistory: () => ({ evidence: [SESSION_LINE] }),
    callModel: async (_registry, req) => {
      calls.push(req);
      return {
        ok: true,
        text: JSON.stringify({
          needs: {
            autonomy: { state: "at_risk", cited: [WINDOW_LINE] },
            competence: { state: "unmet", cited: [WINDOW_LINE] },
            relatedness: { state: "met", cited: [SESSION_LINE] },
          },
          load: { level: "high", cited: [WINDOW_LINE] },
          progress: { state: "blocked", cited: [WINDOW_LINE] },
          flow: { state: "broken", cited: [WINDOW_LINE] },
          interventions: [],
        }),
        provider: "openrouter-soukr",
        modelId: "some/model",
        label: "openrouter-soukr/some/model",
        usage: undefined,
      };
    },
    deliver: async () => ({ human: "none", agent: false, reason: "silent" }),
    ...over,
  };
}

test("thirty healthy turns cost nothing: the evidence rule, not the clock", async () => {
  const pi = makePi();
  const state = triggerState({ cadenceTurns: 3 });
  state.turnsSinceAppraisal = 0;
  const deps = makeDeps();
  const ctx = makeCtx();
  for (let turn = 1; turn <= 30; turn += 1) {
    state.turnsSinceAppraisal += 1;
    // A verified run every three turns: real progress, so the unverified stretch never grows.
    if (turn % 3 === 0) state.observe({ kind: "tool", at: turn, toolName: "bash", command: "npm test", ok: true });
    await maybeAppraise(pi, state, ctx, deps);
  }
  assert.equal(deps.calls.length, 0, "a healthy stretch is not worth a model call");
  // Turns 1 and 2 are still inside the floor; every turn after is a named `no_trigger` skip.
  assert.equal(state.appraisalsSkipped, 28);
});

test("a 3-failure streak at turn 10 runs exactly one appraisal, and not again at turn 14", async () => {
  const pi = makePi();
  const state = triggerState({ cadenceTurns: 3 });
  state.turnsSinceAppraisal = 0;
  const deps = makeDeps();
  const ctx = makeCtx();
  for (let turn = 1; turn <= 14; turn += 1) {
    state.turnsSinceAppraisal += 1;
    if (turn >= 8 && turn <= 10) {
      // Distinct signatures on purpose: three *different* failures make a streak, not a recurrence,
      // so this test isolates `failure_streak` from `recurring_failure`.
      state.observe({
        kind: "tool",
        at: turn,
        toolName: "bash",
        command: "npm test",
        ok: false,
        errorSignature: "timed out " + turn,
      });
    }
    await maybeAppraise(pi, state, ctx, deps);
  }
  assert.equal(deps.calls.length, 1, "the streak spends once, not on every turn it persists");
  assert.ok(state.lastTriggerReasons.includes("failure_streak"));
});

test("the trigger line reaches the prompt and enforcement, so the reason is citable", async () => {
  const pi = makePi();
  const state = triggerState({ cadenceTurns: 3 });
  const TRIGGER_LINE = "appraisal triggered by: failure_streak, recurring_failure";
  const deps = makeDeps({
    callModel: async (_registry, req) => {
      deps.calls.push(req);
      return {
        ok: true,
        text: JSON.stringify({
          needs: {
            autonomy: { state: "at_risk", cited: [TRIGGER_LINE] },
            competence: { state: "unmet", cited: [TRIGGER_LINE] },
            relatedness: { state: "met", cited: [TRIGGER_LINE] },
          },
          load: { level: "high", cited: [TRIGGER_LINE] },
          progress: { state: "blocked", cited: [TRIGGER_LINE] },
          flow: { state: "broken", cited: [TRIGGER_LINE] },
          interventions: [
            { kind: "reduce_load", text: "Run the check before writing more.", cited: [TRIGGER_LINE] },
          ],
        }),
        provider: "p",
        modelId: "m",
        label: "p/m",
        usage: undefined,
      };
    },
  });
  for (let i = 0; i < 3; i += 1) state.observe({ kind: "tool", at: i, toolName: "bash", command: "npm test", ok: false });
  state.turnsSinceAppraisal = 5;

  const outcome = await maybeAppraise(pi, state, makeCtx(), deps);
  assert.equal(outcome.ran, true);
  assert.match(deps.calls[0].userText, /- appraisal triggered by: failure_streak, recurring_failure/);
  assert.deepEqual(outcome.unmatched, [], "the trigger line is admissible evidence, not just prompt text");
  assert.deepEqual(outcome.downgraded, [], "so every citation to it survived enforcement");
});

test("no_trigger is a named skip, so a clockless silence is explained", async () => {
  const pi = makePi();
  const state = triggerState({ cadenceTurns: 1 });
  state.turnsSinceAppraisal = 1;
  const deps = makeDeps();
  const outcome = await maybeAppraise(pi, state, makeCtx(), deps);
  assert.deepEqual(outcome, { ran: false, reason: "no_trigger" });
  assert.equal(deps.calls.length, 0);
  assert.equal(state.appraisalsSkipped, 1);
});

test("force bypasses the trigger rule: an explicit request is not gated on new evidence", async () => {
  const pi = makePi();
  const state = triggerState({ cadenceTurns: 8 });
  state.turnsSinceAppraisal = 0;
  const deps = makeDeps();
  const outcome = await maybeAppraise(pi, state, makeCtx(), deps, { force: true });
  assert.equal(outcome.ran, true, "the operator asked, so the trigger rule is skipped");
  assert.equal(deps.calls.length, 1);
  // A forced attempt still moves the baseline, so the same evidence does not fire a second time.
  assert.equal(state.triggerBaseline.turnsSinceVerifiedProgress, 0);
});

test("/psych shows the trigger rule, the last reasons and the turns it saved", () => {
  const state = triggerState();
  state.lastTriggerReasons = ["failure_streak", "restatement"];
  state.appraisalsSkipped = 5;
  const en = renderReport({ state, signals: [], history: [], lang: "en" });
  assert.match(en, /trigger\s+signals/);
  assert.match(en, /triggered by failure_streak, restatement/);
  assert.match(en, /appraisals skipped: 5 \(no new evidence\)/);
  // The user text is localised in both locales.
  const cs = renderReport({ state, signals: [], history: [], lang: "cs" });
  assert.match(cs, /posouzení přeskočeno: 5 \(žádný nový důkaz\)/);
  assert.match(cs, /spuštěno: failure_streak, restatement/);
});
