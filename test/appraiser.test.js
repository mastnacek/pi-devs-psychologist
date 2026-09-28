/**
 * Appraiser policy — when the psychologist is asked, how much it may spend, and what
 * happens when it fails.
 *
 * The headline assertion is the one the plugin's cost model rests on: over forty turns with
 * an eight-turn cadence and a budget of three, exactly three calls are made and the fourth
 * is refused. Every other test here defends a specific way that could quietly become false —
 * a failure retried every turn, a budget that counts only successes, a second call while one
 * is in flight.
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
  state.config = { ...DEFAULT_CONFIG, model: "openrouter-soukr/some/model", ...over };
  // The cadence gate is open by default, so a test that is not about the cadence is not
  // silently skipped by it. Tests that exercise cadence pass `turns` explicitly.
  state.turnsSinceAppraisal = turns === undefined ? state.config.cadenceTurns : turns;
  return state;
}

function history(evidence = [SESSION_LINE]) {
  return { evidence };
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
  return {
    calls,
    readHistory: () => history(),
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
    notify: (ctx, text) => {
      if (ctx.hasUI) ctx.ui.notify(text, "info");
    },
    ...over,
  };
}

test("the skill's cost rule holds: forty turns, cadence 8, budget 3, exactly three calls", async () => {
  const state = stateWith({ cadenceTurns: 8, maxAppraisalsPerSession: 3 }, 0);
  const deps = makeDeps();
  const ctx = makeCtx();
  const outcomes = [];
  for (let turn = 0; turn < 40; turn += 1) {
    state.turnsSinceAppraisal += 1;
    outcomes.push(await maybeAppraise(state, ctx, deps));
  }
  assert.equal(deps.calls.length, 3, "the budget is a ceiling, not a suggestion");
  assert.equal(state.appraisalsThisSession, 3);
  const ran = outcomes.filter((outcome) => outcome.ran);
  assert.equal(ran.length, 3);
  // The fourth attempt was reached on turn 32 and refused for budget, not cadence.
  assert.equal(outcomes.at(-1).ran, false);
  assert.equal(outcomes.at(-1).reason, "budget");
});

test("a failed attempt still consumes the budget, because a failed call may still bill", async () => {
  const state = stateWith({ cadenceTurns: 1, maxAppraisalsPerSession: 2 });
  const deps = makeDeps({
    callModel: async () => ({ ok: false, stage: "request", error: "ECONNRESET" }),
  });
  const ctx = makeCtx();
  for (let turn = 0; turn < 10; turn += 1) {
    state.turnsSinceAppraisal += 1;
    await maybeAppraise(state, ctx, deps);
  }
  assert.equal(state.appraisalsThisSession, 2);
  assert.equal(state.budgetAvailable(), false);
});

test("a failed attempt restarts the cadence, so a broken model is not retried every turn", async () => {
  const state = stateWith({ cadenceTurns: 3, maxAppraisalsPerSession: 0 });
  let attempts = 0;
  const deps = makeDeps({
    callModel: async () => {
      attempts += 1;
      return { ok: false, stage: "response", error: "rate limited" };
    },
  });
  const ctx = makeCtx();
  // Six turns with a three-turn cadence: two attempts at most, not six.
  for (let turn = 0; turn < 6; turn += 1) {
    state.turnsSinceAppraisal += 1;
    await maybeAppraise(state, ctx, deps);
  }
  assert.equal(attempts, 2, "a spend loop would have produced six");
});

test("every skip reason is named, so silence is always explained", async () => {
  const ctx = makeCtx();
  const deps = makeDeps();

  const disabled = await maybeAppraise(stateWith({ enabled: false }), ctx, deps);
  assert.deepEqual(disabled, { ran: false, reason: "disabled" });

  const headlessCtx = makeCtx({ hasUI: false, mode: "json" });
  const headless = await maybeAppraise(stateWith({ cadenceTurns: 1 }), headlessCtx, deps);
  assert.deepEqual(headless, { ran: false, reason: "headless" });

  const noModel = await maybeAppraise(stateWith({ model: "   ", cadenceTurns: 1 }), ctx, deps);
  assert.deepEqual(noModel, { ran: false, reason: "no_model" });

  // `turns: 0` is the point of this case: the gate is closed on purpose.
  const tooEarly = await maybeAppraise(stateWith({ cadenceTurns: 8 }, 0), ctx, deps);
  assert.deepEqual(tooEarly, { ran: false, reason: "cadence" });

  const spent = stateWith({ cadenceTurns: 1, maxAppraisalsPerSession: 1 });
  spent.appraisalsThisSession = 1;
  // The cadence gate must be open too, or the budget is never reached and the test
  // would pass for the wrong reason.
  spent.turnsSinceAppraisal = 5;
  assert.deepEqual(await maybeAppraise(spent, ctx, deps), { ran: false, reason: "budget" });

  const busy = stateWith({ cadenceTurns: 1 });
  busy.appraisalInFlight = true;
  assert.deepEqual(await maybeAppraise(busy, ctx, deps), { ran: false, reason: "in_flight" });

  assert.equal(deps.calls.length, 0, "no skip reason may reach the model");
});

test("a headless session spends nothing, because nobody could read the result", async () => {
  const state = stateWith({ cadenceTurns: 1 });
  const deps = makeDeps();
  await maybeAppraise(state, makeCtx({ hasUI: false, mode: "print" }), deps);
  assert.equal(deps.calls.length, 0);
  assert.equal(state.appraisalsThisSession, 0);
});

test("a successful appraisal is stored, cited, costed and delivered once", async () => {
  const state = stateWith({ cadenceTurns: 1 });
  const deps = makeDeps();
  const ctx = makeCtx();

  const outcome = await maybeAppraise(state, ctx, deps);
  assert.equal(outcome.ran, true);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.silent, false);
  assert.deepEqual(outcome.unmatched, []);
  assert.deepEqual(outcome.downgraded, []);

  assert.equal(state.lastAppraisal.progress.state, "blocked");
  assert.deepEqual(state.lastAppraisal.interventions[0].cited, [WINDOW_LINE]);
  assert.deepEqual(state.lastAppraisalNotes, { unmatched: [], downgraded: [] });
  assert.equal(state.lastAppraisalUsage.cost, 0.002, "the plugin reports its own spend");
  assert.equal(state.lastAppraisalFailure, undefined);
  assert.equal(typeof state.lastAppraisalAt, "number");

  assert.equal(ctx.notes.length, 1, "exactly one line, never a list");
  assert.equal(ctx.notes[0].message, "Name the smallest shippable increment.");
  assert.equal(ctx.notes[0].level, "info");
});

test("a response with no citable verdict lands as silence, with no notification", async () => {
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
  const ctx = makeCtx();
  const outcome = await maybeAppraise(state, ctx, deps);

  assert.equal(outcome.ran, true);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.silent, true);
  assert.equal(ctx.notes.length, 0, "a fabricated appraisal must not be shown to anyone");
  assert.ok(outcome.downgraded.length > 0, "and the reason is recorded");
});

test("a model failure is a typed outcome, never a thrown turn", async () => {
  const state = stateWith({ cadenceTurns: 1 });
  const deps = makeDeps({
    callModel: async () => ({ ok: false, stage: "auth", error: "p/m: no credentials" }),
  });
  const ctx = makeCtx();
  const outcome = await maybeAppraise(state, ctx, deps);
  assert.equal(outcome.ran, true);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.stage, "auth");
  assert.deepEqual(state.lastAppraisalFailure, { stage: "auth", error: "p/m: no credentials" });
  assert.equal(ctx.notes.length, 0, "a transient failure must not nag");
});

test("a throw from the model call is caught and attributed to the request stage", async () => {
  const state = stateWith({ cadenceTurns: 1 });
  const deps = makeDeps({
    callModel: async () => {
      throw new Error("unexpected explosion");
    },
  });
  const outcome = await maybeAppraise(state, makeCtx(), deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.stage, "request");
  assert.match(outcome.error, /unexpected explosion/);
  assert.equal(state.appraisalInFlight, false, "the single-flight flag is released even on a throw");
});

test("a slow appraisal is not asked twice: the in-flight flag is held across the await", async () => {
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

  const first = maybeAppraise(state, ctx, deps);
  // Two more turns arrive while the model is still thinking.
  state.turnsSinceAppraisal += 1;
  assert.deepEqual(await maybeAppraise(state, ctx, deps), { ran: false, reason: "in_flight" });
  state.turnsSinceAppraisal += 1;
  assert.deepEqual(await maybeAppraise(state, ctx, deps), { ran: false, reason: "in_flight" });

  release();
  assert.equal((await first).ok, true);
  assert.equal(calls, 1);
});

test("the prompt the model receives is exactly the evidence enforcement will police", async () => {
  // The round trip matters: a response citing a line from the prompt must survive, and the
  // only way to know the two agree is to check the prompt text itself.
  const state = stateWith({ cadenceTurns: 1 });
  const deps = makeDeps();
  await maybeAppraise(state, makeCtx(), deps);

  const req = deps.calls[0];
  assert.match(req.systemPrompt, /engineering psychologist/);
  assert.match(req.systemPrompt, /cite/i);
  assert.equal(req.modelRef, "openrouter-soukr/some/model");
  assert.ok(req.userText.includes(`- ${WINDOW_LINE}`), "live evidence is in the prompt");
  assert.ok(req.userText.includes(`- ${SESSION_LINE}`), "session evidence is in the prompt");
  assert.equal(req.maxTokens, 1200);
  assert.equal(req.signal, undefined);
});

test("the chip is repainted after an attempt, so the budget is visible", async () => {
  const state = stateWith({ cadenceTurns: 1 });
  const ctx = makeCtx();
  await maybeAppraise(state, ctx, makeDeps());
  assert.deepEqual(ctx.statusCalls.at(-1), { id: "devs-psychologist", text: "psych 0t · 1/12" });
});

test("registerAppraiser subscribes turn_end and tracks it for shutdown", () => {
  const pi = makePi();
  const state = makeState();
  registerAppraiser(pi, state, makeDeps());
  assert.ok(pi.handlers.has("turn_end"));
  assert.equal(state.unsubscribers.length, 1);
});