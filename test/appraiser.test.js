/**
 * Appraiser policy — when the psychologist is asked, how much it may spend, and what happens
 * when it fails.
 *
 * The headline assertion is the one the plugin's cost model rests on: over forty turns with an
 * eight-turn cadence and a budget of three, exactly three calls are made and the fourth is
 * refused. Every other test here defends a specific way that could quietly become false — a
 * failure retried every turn, a budget that counts only successes, a second call while one is
 * in flight.
 *
 * Delivery is now *injected* rather than performed here, so these tests assert that the appraiser
 * hands the enforced appraisal to the policy exactly once. What the policy then does with it —
 * card, notification, steering — is `interventions.test.js`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { maybeAppraise, registerAppraiser } from "../src/slices/appraiser/index.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

/** The exact evidence line an empty observation window produces. */
const WINDOW_LINE = "window: 0 prompt(s), 0 tool call(s), 0 min";
const SESSION_LINE = "session span: 3 min";

function stateWith(over = {}, turns = undefined) {
  const state = makeState();
  // `trigger: "cadence"` is explicit here: these tests are about the clock, the budget and the
  // single-flight rule, so they must not be silently governed by the evidence-trigger rule. The
  // trigger tests override it with `trigger: "signals"` where that is the subject.
  state.config = { ...DEFAULT_CONFIG, model: "openrouter-soukr/some/model", trigger: "cadence", ...over };
  // The cadence gate is open by default, so a test that is not about the cadence is not
  // silently skipped by it. Tests that exercise cadence pass `turns` explicitly.
  state.turnsSinceAppraisal = turns === undefined ? state.config.cadenceTurns : turns;
  return state;
}

/** A response that cites real lines, so enforcement keeps it. */
function validResponse(over = {}) {
  return JSON.stringify({
    needs: {
      autonomy: { state: "at_risk", cited: [WINDOW_LINE] },
      competence: { state: "unmet", cited: [WINDOW_LINE] },
      relatedness: { state: "met", cited: [SESSION_LINE] },
    },
    load: { level: "high", cited: [WINDOW_LINE] },
    progress: { state: "blocked", cited: [WINDOW_LINE] },
    flow: { state: "broken", cited: [WINDOW_LINE] },
    interventions: [
      { kind: "name_next_win", text: "Name the smallest shippable increment.", cited: [WINDOW_LINE] },
    ],
    ...over,
  });
}

function makeDeps(over = {}) {
  const calls = [];
  const deliveries = [];
  const deliveryOptions = [];
  return {
    deliveryOptions,
    calls,
    deliveries,
    readHistory: () => ({ evidence: [SESSION_LINE] }),
    callModel: async (_registry, req) => {
      calls.push(req);
      return {
        ok: true,
        text: validResponse(),
        provider: "openrouter-soukr",
        modelId: "some/model",
        label: "openrouter-soukr/some/model",
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { total: 0.002 } },
      };
    },
    deliver: async (_api, _state, _ctx, appraisal, options) => {
      deliveries.push(appraisal);
      deliveryOptions.push(options);
      return { human: "card", agent: false };
    },
    ...over,
  };
}

test("the cost rule holds: forty turns, cadence 8, budget 3, exactly three calls", async () => {
  const pi = makePi();
  const state = stateWith({ cadenceTurns: 8, maxAppraisalsPerSession: 3 }, 0);
  const deps = makeDeps();
  const ctx = makeCtx();
  const outcomes = [];
  for (let turn = 0; turn < 40; turn += 1) {
    state.turnsSinceAppraisal += 1;
    outcomes.push(await maybeAppraise(pi, state, ctx, deps));
  }
  assert.equal(deps.calls.length, 3, "the budget is a ceiling, not a suggestion");
  assert.equal(state.appraisalsThisSession, 3);
  assert.equal(deps.deliveries.length, 3);
  // The fourth attempt was reached on turn 32 and refused for budget, not cadence.
  assert.equal(outcomes.at(-1).ran, false);
  assert.equal(outcomes.at(-1).reason, "budget");
});

test("a failed attempt still consumes the budget, because a failed call may still bill", async () => {
  const pi = makePi();
  const state = stateWith({ cadenceTurns: 1, maxAppraisalsPerSession: 2 });
  const deps = makeDeps({
    callModel: async () => ({ ok: false, stage: "request", error: "ECONNRESET" }),
  });
  const ctx = makeCtx();
  for (let turn = 0; turn < 10; turn += 1) {
    state.turnsSinceAppraisal += 1;
    await maybeAppraise(pi, state, ctx, deps);
  }
  assert.equal(state.appraisalsThisSession, 2);
  assert.equal(state.budgetAvailable(), false);
  assert.equal(deps.deliveries.length, 0, "a failure has nothing to deliver");
});

test("a failed attempt restarts the cadence, so a broken model is not retried every turn", async () => {
  const pi = makePi();
  const state = stateWith({ cadenceTurns: 3, maxAppraisalsPerSession: 0 });
  let attempts = 0;
  const deps = makeDeps({
    callModel: async () => {
      attempts += 1;
      return { ok: false, stage: "response", error: "rate limited" };
    },
  });
  const ctx = makeCtx();
  for (let turn = 0; turn < 6; turn += 1) {
    state.turnsSinceAppraisal += 1;
    await maybeAppraise(pi, state, ctx, deps);
  }
  assert.equal(attempts, 2, "a spend loop would have produced six");
});

test("every skip reason is named, so silence is always explained", async () => {
  const pi = makePi();
  const ctx = makeCtx();
  const deps = makeDeps();

  assert.deepEqual(await maybeAppraise(pi, stateWith({ enabled: false }), ctx, deps), {
    ran: false,
    reason: "disabled",
  });

  const headless = makeCtx({ hasUI: false, mode: "json" });
  assert.deepEqual(await maybeAppraise(pi, stateWith({ cadenceTurns: 1 }), headless, deps), {
    ran: false,
    reason: "headless",
  });

  assert.deepEqual(await maybeAppraise(pi, stateWith({ model: "   ", cadenceTurns: 1 }), ctx, deps), {
    ran: false,
    reason: "no_model",
  });

  // `turns: 0` is the point of this case: the gate is closed on purpose.
  assert.deepEqual(await maybeAppraise(pi, stateWith({ cadenceTurns: 8 }, 0), ctx, deps), {
    ran: false,
    reason: "cadence",
  });

  const spent = stateWith({ cadenceTurns: 1, maxAppraisalsPerSession: 1 });
  spent.appraisalsThisSession = 1;
  // The cadence gate must be open too, or the budget is never reached and the test would
  // pass for the wrong reason.
  spent.turnsSinceAppraisal = 5;
  assert.deepEqual(await maybeAppraise(pi, spent, ctx, deps), { ran: false, reason: "budget" });

  const busy = stateWith({ cadenceTurns: 1 });
  busy.appraisalInFlight = true;
  assert.deepEqual(await maybeAppraise(pi, busy, ctx, deps), { ran: false, reason: "in_flight" });

  assert.equal(deps.calls.length, 0, "no skip reason may reach the model");
});

test("a headless session spends nothing, because nobody could read the result", async () => {
  const pi = makePi();
  const state = stateWith({ cadenceTurns: 1 });
  const deps = makeDeps();
  await maybeAppraise(pi, state, makeCtx({ hasUI: false, mode: "print" }), deps);
  assert.equal(deps.calls.length, 0);
  assert.equal(state.appraisalsThisSession, 0);
});

test("force skips the cadence, because the operator asked explicitly", async () => {
  const pi = makePi();
  const state = stateWith({ cadenceTurns: 8 }, 0);
  const deps = makeDeps();
  const outcome = await maybeAppraise(pi, state, makeCtx(), deps, { force: true });
  assert.equal(outcome.ran, true);
  assert.equal(deps.calls.length, 1);
  // And the request is passed on to delivery, so the analysis is shown even with no advice.
  assert.deepEqual(deps.deliveryOptions, [{ evenIfSilent: true }]);
});

test("force does NOT bypass the budget: a ceiling that yields on request is not a ceiling", async () => {
  const pi = makePi();
  const state = stateWith({ cadenceTurns: 1, maxAppraisalsPerSession: 1 }, 0);
  state.appraisalsThisSession = 1;
  const deps = makeDeps();
  const outcome = await maybeAppraise(pi, state, makeCtx(), deps, { force: true });
  assert.deepEqual(outcome, { ran: false, reason: "budget" });
  assert.equal(deps.calls.length, 0);
});

test("an automatic appraisal is delivered without the show-even-if-silent option", async () => {
  const pi = makePi();
  const deps = makeDeps();
  await maybeAppraise(pi, stateWith({ cadenceTurns: 1 }), makeCtx(), deps);
  assert.deepEqual(deps.deliveryOptions, [{ evenIfSilent: false }]);
});

test("a successful appraisal is stored, cited, costed and handed to delivery once", async () => {
  const pi = makePi();
  const state = stateWith({ cadenceTurns: 1 });
  const deps = makeDeps();

  const outcome = await maybeAppraise(pi, state, makeCtx(), deps);
  assert.equal(outcome.ran, true);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.silent, false);
  assert.deepEqual(outcome.unmatched, []);
  assert.deepEqual(outcome.downgraded, []);
  assert.deepEqual(outcome.delivery, { human: "card", agent: false });

  assert.equal(state.lastAppraisal.progress.state, "blocked");
  assert.deepEqual(state.lastAppraisal.interventions[0].cited, [WINDOW_LINE]);
  assert.deepEqual(state.lastAppraisalNotes, { unmatched: [], downgraded: [] });
  assert.equal(state.lastAppraisalUsage.cost, 0.002, "the plugin reports its own spend");
  assert.equal(state.lastAppraisalFailure, undefined);
  assert.equal(typeof state.lastAppraisalAt, "number");

  assert.equal(deps.deliveries.length, 1, "one appraisal, one delivery decision");
  assert.equal(deps.deliveries[0].interventions[0].text, "Name the smallest shippable increment.");
});

test("a response with no citable verdict lands as silence", async () => {
  const pi = makePi();
  const state = stateWith({ cadenceTurns: 1 });
  const deps = makeDeps({
    callModel: async () => ({
      ok: true,
      text: JSON.stringify({
        needs: {
          autonomy: { state: "unmet", cited: ["invented"] },
          competence: { state: "unmet", cited: ["invented"] },
          relatedness: { state: "unmet", cited: ["invented"] },
        },
        load: { level: "high", cited: ["invented"] },
        progress: { state: "blocked", cited: ["invented"] },
        flow: { state: "broken", cited: ["invented"] },
        interventions: [{ kind: "stop", text: "Stop for today.", cited: ["invented"] }],
      }),
      provider: "p",
      modelId: "m",
      label: "p/m",
      usage: undefined,
    }),
  });
  const outcome = await maybeAppraise(pi, state, makeCtx(), deps);

  assert.equal(outcome.ran, true);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.silent, true);
  assert.ok(outcome.downgraded.length > 0, "and the reason is recorded");
  // The policy still runs — it is the one that decides what silence means.
  assert.equal(deps.deliveries.length, 1);
});

test("a model failure is a typed outcome, never a thrown turn", async () => {
  const pi = makePi();
  const state = stateWith({ cadenceTurns: 1 });
  const deps = makeDeps({
    callModel: async () => ({ ok: false, stage: "auth", error: "p/m: no credentials" }),
  });
  const outcome = await maybeAppraise(pi, state, makeCtx(), deps);
  assert.equal(outcome.ran, true);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.stage, "auth");
  assert.deepEqual(state.lastAppraisalFailure, { stage: "auth", error: "p/m: no credentials" });
});

test("a throw from the model call is caught and attributed to the request stage", async () => {
  const pi = makePi();
  const state = stateWith({ cadenceTurns: 1 });
  const deps = makeDeps({
    callModel: async () => {
      throw new Error("unexpected explosion");
    },
  });
  const outcome = await maybeAppraise(pi, state, makeCtx(), deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.stage, "request");
  assert.match(outcome.error, /unexpected explosion/);
  assert.equal(state.appraisalInFlight, false, "the single-flight flag is released even on a throw");
});

test("a delivery failure does not fail the turn: the appraisal is already stored", async () => {
  const pi = makePi();
  const state = stateWith({ cadenceTurns: 1 });
  const deps = makeDeps({
    deliver: async () => {
      throw new Error("the overlay exploded");
    },
  });
  const outcome = await maybeAppraise(pi, state, makeCtx(), deps);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.delivery, { human: "none", agent: false, reason: "silent" }, "the safe default");
  assert.equal(state.lastAppraisal.progress.state, "blocked", "and the appraisal survived");
});

test("a slow appraisal is not asked twice: the in-flight flag is held across the await", async () => {
  const pi = makePi();
  const state = stateWith({ cadenceTurns: 1, maxAppraisalsPerSession: 0 });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const deps = makeDeps({
    callModel: async () => {
      calls += 1;
      await gate;
      return { ok: true, text: validResponse(), provider: "p", modelId: "m", label: "p/m", usage: undefined };
    },
  });
  const ctx = makeCtx();

  const first = maybeAppraise(pi, state, ctx, deps);
  // Two more turns arrive while the model is still thinking.
  state.turnsSinceAppraisal += 1;
  assert.deepEqual(await maybeAppraise(pi, state, ctx, deps), { ran: false, reason: "in_flight" });
  state.turnsSinceAppraisal += 1;
  assert.deepEqual(await maybeAppraise(pi, state, ctx, deps), { ran: false, reason: "in_flight" });

  release();
  assert.equal((await first).ok, true);
  assert.equal(calls, 1);
});

test("the prompt the model receives is exactly the evidence enforcement will police", async () => {
  // The round trip matters: a response citing a line from the prompt must survive, and the only
  // way to know the two agree is to check the prompt text itself.
  const pi = makePi();
  const deps = makeDeps();
  await maybeAppraise(pi, stateWith({ cadenceTurns: 1 }), makeCtx(), deps);

  const req = deps.calls[0];
  assert.match(req.systemPrompt, /engineering psychologist/);
  assert.match(req.systemPrompt, /cite/i);
  assert.equal(req.modelRef, "openrouter-soukr/some/model");
  assert.ok(req.userText.includes(`- ${WINDOW_LINE}`), "live evidence is in the prompt");
  assert.ok(req.userText.includes(`- ${SESSION_LINE}`), "session evidence is in the prompt");
  assert.equal(req.maxTokens, 1200);
});

test("the chip is repainted after an attempt, so the budget is visible", async () => {
  const pi = makePi();
  const state = stateWith({ cadenceTurns: 1 });
  const ctx = makeCtx();
  await maybeAppraise(pi, state, ctx, makeDeps());
  assert.deepEqual(ctx.statusCalls.at(-1), { id: "devs-psychologist", text: "psych 0t · 1/12" });
});

test("registerAppraiser subscribes turn_end and tracks it for shutdown", () => {
  const pi = makePi();
  const state = makeState();
  registerAppraiser(pi, state, makeDeps());
  assert.ok(pi.handlers.has("turn_end"));
  assert.equal(state.unsubscribers.length, 1);
});
