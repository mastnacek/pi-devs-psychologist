/**
 * Delivery policy — one intervention, to the human, and to the agent only if asked.
 *
 * Three of these are T5's stated requirements: two interventions never render, `steerAgent: false`
 * never touches the working agent's context, and an empty appraisal produces silence. The rest pin
 * the fallback ladder, because "the card could not render" must degrade to something visible
 * rather than to nothing — silence and a broken overlay look identical from the outside.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { defaultInterventionDeps, deliverIntervention } from "../src/slices/interventions/index.js";
import { neutralAppraisal } from "../src/shared/appraisal.js";
import { isSilent } from "../src/shared/appraisal-enforce.js";
import { steerText } from "../src/shared/prompt.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

const APPEAL = "Name the smallest shippable increment.";

function appraisalWith(interventions) {
  const base = neutralAppraisal();
  base.progress = { state: "blocked", cited: ["verified progress: none"] };
  base.interventions = interventions;
  return base;
}

const WITH_ONE = appraisalWith([
  { kind: "name_next_win", text: APPEAL, cited: ["verified progress: none"] },
]);

function stateWith(over = {}) {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, model: "a/b", ...over };
  return state;
}

function makeDeps(over = {}) {
  const seen = { present: 0, notify: [], steer: [] };
  return {
    seen,
    present: async () => {
      seen.present += 1;
      return true;
    },
    notify: (_ctx, text) => seen.notify.push(text),
    steer: (_pi, _ctx, text) => seen.steer.push(text),
    ...over,
  };
}

async function deliver(state, ctx, appraisal, deps, pi = makePi(), options = undefined) {
  return deliverIntervention(pi, state, ctx, appraisal, deps, options);
}

test("an empty appraisal produces silence, and no surface is touched", async () => {
  const deps = makeDeps();
  const outcome = await deliver(stateWith(), makeCtx(), neutralAppraisal(), deps);
  assert.deepEqual(outcome, { human: "none", agent: false, reason: "silent" });
  assert.equal(deps.seen.present, 0, "a silent appraisal must not open a window");
  assert.deepEqual(deps.seen.notify, []);
  assert.deepEqual(deps.seen.steer, []);
});

test("only the first intervention is ever delivered, and one is the contract maximum", async () => {
  // The schema caps this at one and enforcement drops an over-long batch, but the policy must not
  // become a second place where "two suggestions" quietly becomes acceptable.
  const two = appraisalWith([
    { kind: "thin_slice", text: APPEAL, cited: ["verified progress: none"] },
    { kind: "reduce_load", text: "Run the tests first.", cited: ["verified progress: none"] },
  ]);
  const deps = makeDeps();
  const ctx = makeCtx();
  const outcome = await deliver(stateWith(), ctx, two, deps);
  assert.equal(outcome.human, "card");
  assert.equal(deps.seen.present, 1, "one card, not two");
  assert.deepEqual(deps.seen.notify, [], "and not also a notification");
  assert.equal(ctx.notes.length, 0);
});

test("the card is the human surface when it can render", async () => {
  const deps = makeDeps();
  const outcome = await deliver(stateWith(), makeCtx(), WITH_ONE, deps);
  assert.deepEqual(outcome, { human: "card", agent: false });
  assert.equal(deps.seen.present, 1);
  assert.deepEqual(deps.seen.notify, [], "no redundant notification under the card");
});

test("where a card cannot render, the fallback is a notification, not silence", async () => {
  // RPC has a UI but no custom(); mode=json has neither. Either way the operator must still see it.
  const deps = makeDeps({ present: async () => false });
  const outcome = await deliver(stateWith(), makeCtx(), WITH_ONE, deps);
  assert.deepEqual(outcome, { human: "notification", agent: false });
  assert.deepEqual(deps.seen.notify, [APPEAL]);
});

test("a presentation throw degrades to the notification rather than losing the intervention", async () => {
  const deps = makeDeps({
    present: async () => {
      throw new Error("overlay exploded");
    },
  });
  // An overlay that cannot draw and a plugin that says nothing look identical from the outside,
  // so the ladder must continue rather than lose the intervention.
  const outcome = await deliver(stateWith(), makeCtx(), WITH_ONE, deps);
  assert.deepEqual(outcome, { human: "notification", agent: false });
  assert.deepEqual(deps.seen.notify, [APPEAL], "the intervention still arrived");
});

test("without a UI there is nothing to deliver to, and that is stated", async () => {
  const deps = makeDeps();
  const outcome = await deliver(stateWith(), makeCtx({ hasUI: false, mode: "json" }), WITH_ONE, deps);
  assert.deepEqual(outcome, { human: "none", agent: false, reason: "no_ui" });
  assert.equal(deps.seen.present, 0, "no attempt to render without a UI");
  assert.deepEqual(deps.seen.steer, []);
});

test("an explicit request shows the analysis even when it has no advice", async () => {
  // Silence is the right default for an appraisal the plugin chose to run, and the wrong answer
  // to an operator who asked for one: the verdicts ARE the analysis. Without this, `/psych now`
  // on a quiet session looked like a refusal to work.
  const verdictsOnly = { ...neutralAppraisal(), progress: { state: "unproven", cited: [] } };
  assert.equal(isSilent(verdictsOnly), true, "this appraisal carries no intervention");

  const quiet = makeDeps();
  const asked = await deliver(stateWith(), makeCtx(), verdictsOnly, quiet, makePi(), { evenIfSilent: true });
  assert.equal(quiet.seen.present, 1, "the card is shown when the operator asked");
  assert.equal(asked.human, "card");

  const automatic = makeDeps();
  const silence = await deliver(stateWith(), makeCtx(), verdictsOnly, automatic);
  assert.equal(automatic.seen.present, 0, "an automatic appraisal still keeps its silence");
  assert.deepEqual(silence, { human: "none", agent: false, reason: "silent" });
});

test("an analysis with no advice still reaches the operator where no card can render", async () => {
  // The notify fallback used the intervention's text, which is undefined in this case, and the
  // try/catch swallowed it — so the fallback showed nothing at all.
  const verdictsOnly = { ...neutralAppraisal(), progress: { state: "unproven", cited: [] } };
  const deps = makeDeps({ present: async () => false });
  const outcome = await deliver(stateWith(), makeCtx(), verdictsOnly, deps, makePi(), { evenIfSilent: true });
  assert.equal(outcome.human, "notification");
  assert.equal(deps.seen.notify.length, 1);
  assert.ok(deps.seen.notify[0].length > 0, "and it says something rather than an empty string");
});

test("steerAgent false never touches the working agent's context", async () => {
  const deps = makeDeps();
  await deliver(stateWith({ steerAgent: false }), makeCtx(), WITH_ONE, deps);
  assert.deepEqual(deps.seen.steer, [], "the observer is not an authority by default");
});

test("steerAgent true writes exactly one line, and the card is still shown", async () => {
  const deps = makeDeps();
  const outcome = await deliver(stateWith({ steerAgent: true }), makeCtx(), WITH_ONE, deps);
  assert.deepEqual(outcome, { human: "card", agent: true });
  assert.deepEqual(deps.seen.steer, [APPEAL], "the raw intervention, prefixed by the steer helper");
});

test("steering is attributed to an observer, and the agent is told it may decline", async () => {
  const body = steerText(APPEAL);
  assert.match(body, /^\[pi-devs-psychologist\] /, "the agent must not read it as the user speaking");
  assert.match(body, /not from the user/);
  assert.match(body, /do not obey it blindly/);
  assert.ok(body.includes(APPEAL));
});

test("the real deps send while idle and queue as a follow-up while streaming", () => {
  const deps = defaultInterventionDeps(async () => true);
  const sent = [];
  const pi = { sendUserMessage: (body, options) => sent.push({ body, options }) };

  deps.steer(pi, makeCtx({ isIdle: () => true }), APPEAL);
  deps.steer(pi, makeCtx({ isIdle: () => false }), APPEAL);

  assert.equal(sent.length, 2);
  assert.equal(sent[0].options, undefined, "idle: send now");
  assert.deepEqual(sent[1].options, { deliverAs: "followUp" }, "streaming: never injected mid-stream");
  assert.ok(sent[0].body.includes(APPEAL));
});

test("the real notify is silent without a UI and never throws into the turn", () => {
  const deps = defaultInterventionDeps(async () => true);
  const noUi = makeCtx({ hasUI: false });
  deps.notify(noUi, APPEAL);
  assert.deepEqual(noUi.notes, []);
  const ctx = makeCtx();
  deps.notify(ctx, APPEAL);
  assert.deepEqual(ctx.notes, [{ message: APPEAL, level: "info" }]);
});
