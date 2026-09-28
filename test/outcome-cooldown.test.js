/**
 * Anti-nag cooldown (T17) — the ledger stops the plugin repeating advice that did not work.
 *
 * The rule these tests defend, end to end through `maybeAppraise`: a kind delivered twice with no
 * improvement is dropped on the third attempt, the model is warned `do not repeat` from the second
 * attempt on, and `stop` is exempt from cooldown but not from muting.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { maybeAppraise, settleOutcomes } from "../src/slices/appraiser/index.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

const WINDOW_LINE = "window: 0 prompt(s), 0 tool call(s), 0 min";
const SESSION_LINE = "session span: 3 min";

function stateFor() {
  const state = makeState();
  // `outcomeWindowTurns: 1` keeps the test deterministic: one turn after delivery is enough to
  // close the window, so no observation needs to change for a verdict to form (all metrics
  // unchanged = no improvement, which is exactly the case T17 is about).
  state.config = {
    ...DEFAULT_CONFIG,
    model: "openrouter-soukr/some/model",
    trigger: "cadence",
    cadenceTurns: 1,
    outcomeWindowTurns: 1,
    cooldownTurns: 6,
  };
  return state;
}

function responseFor(kind) {
  return JSON.stringify({
    needs: {
      autonomy: { state: "at_risk", cited: [WINDOW_LINE] },
      competence: { state: "unmet", cited: [WINDOW_LINE] },
      relatedness: { state: "met", cited: [SESSION_LINE] },
    },
    load: { level: "high", cited: [WINDOW_LINE] },
    progress: { state: "blocked", cited: [WINDOW_LINE] },
    flow: { state: "broken", cited: [WINDOW_LINE] },
    interventions: [{ kind, text: "Do the one small thing next.", cited: [WINDOW_LINE] }],
  });
}

function makeDeps(kind) {
  const calls = [];
  return {
    calls,
    readHistory: () => ({ evidence: [SESSION_LINE], abortedTurns: 0 }),
    callModel: async (_registry, req) => {
      calls.push(req);
      return { ok: true, text: responseFor(kind), provider: "p", modelId: "m", label: "p/m", usage: undefined };
    },
    deliver: async () => ({ human: "card", agent: false }),
  };
}

/** A model turn: appraise at `turnCount`, then close any window that has now elapsed. */
async function turn(pi, state, ctx, deps, turnCount) {
  state.turnCount = turnCount;
  state.turnsSinceAppraisal = state.config.cadenceTurns;
  const outcome = await maybeAppraise(pi, state, ctx, deps);
  // Deliberately no settle here: a window closes on the NEXT turn, so the test can see the
  // cooling-but-not-yet-muted state before muting is decided.
  return outcome;
}

/** Advance the clock one turn without asking the model, so open windows close. */
function advance(pi, state, ctx, deps, turnCount) {
  state.turnCount = turnCount;
  settleOutcomes(pi, state, ctx, deps);
}

test("a kind delivered twice with no improvement is dropped on the third attempt", async () => {
  const pi = makePi();
  const state = stateFor();
  const ctx = makeCtx();
  const deps = makeDeps("thin_slice");

  const first = await turn(pi, state, ctx, deps, 1);
  assert.equal(first.ok, true);
  assert.equal(state.outcomes.length, 1, "the first delivery is recorded");
  assert.equal(state.outcomes[0].kind, "thin_slice");
  assert.ok(!deps.calls[0].userText.includes("do not repeat"), "nothing to warn about yet");

  advance(pi, state, ctx, deps, 2); // closes the first window: all metrics unchanged

  const second = await turn(pi, state, ctx, deps, 2);
  assert.equal(state.outcomes.length, 2, "the second delivery is recorded, not dropped");
  assert.match(deps.calls[1].userText, /do not repeat: thin_slice \(named 1 times, no change\)/,
    "from the second call on, the model is warned off the cooling kind");
  assert.ok(!second.downgraded.includes("cooldown"), "cooling alone does not drop the advice");

  advance(pi, state, ctx, deps, 3); // closes the second window

  const third = await turn(pi, state, ctx, deps, 3);
  assert.equal(state.outcomes.length, 2, "the third attempt is dropped, not delivered");
  assert.ok(third.downgraded.includes("cooldown"), "and the drop is recorded for the report");
  assert.match(deps.calls[2].userText, /do not repeat: thin_slice \(named 2 times, no change\)/);
});

test("the drop keeps the verdicts and only removes the intervention", async () => {
  const pi = makePi();
  const state = stateFor();
  const ctx = makeCtx();
  const deps = makeDeps("thin_slice");
  await turn(pi, state, ctx, deps, 1);
  advance(pi, state, ctx, deps, 2);
  await turn(pi, state, ctx, deps, 2);
  advance(pi, state, ctx, deps, 3);
  const third = await turn(pi, state, ctx, deps, 3);
  assert.equal(third.ok, true);
  assert.equal(third.appraisal.interventions.length, 0, "the repeat is refused");
  assert.equal(third.appraisal.progress.state, "blocked", "but the analysis is intact");
});

test("`stop` is exempt from cooldown but still muted after two useless deliveries", async () => {
  const pi = makePi();
  const state = stateFor();
  const ctx = makeCtx();
  const deps = makeDeps("stop");

  const first = await turn(pi, state, ctx, deps, 1);
  assert.equal(first.ok, true);
  assert.ok(!deps.calls[0].userText.includes("do not repeat: stop"), "no stop warning before any delivery");

  advance(pi, state, ctx, deps, 2);
  const second = await turn(pi, state, ctx, deps, 2);
  assert.equal(state.outcomes.length, 2, "stop delivered twice");
  assert.ok(!deps.calls[1].userText.includes("do not repeat: stop"),
    "stop is exempt from the cooldown warning");
  assert.ok(!second.downgraded.includes("cooldown"));

  advance(pi, state, ctx, deps, 3);
  const third = await turn(pi, state, ctx, deps, 3);
  assert.equal(state.outcomes.length, 2, "the third stop is dropped");
  assert.ok(third.downgraded.includes("cooldown"));
  assert.match(deps.calls[2].userText, /do not repeat: stop \(named 2 times, no change\)/,
    "muting is not exempt: once stop is muted, the warning follows");
});
