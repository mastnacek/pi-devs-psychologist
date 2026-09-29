/**
 * Same-model warning — the observer that is not a second opinion says so.
 *
 * README tells the operator to pick a model the worker is not; this pins the code that makes the
 * claim visible, and the three cases that must stay silent (a different model, an unknown session
 * model, a headless context) rather than guessing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { modelRefOf, sameModelWarning } from "../src/shared/same-model.js";
import { paintChip, STATUS_ID } from "../src/shared/status.js";
import { renderReport } from "../src/slices/report/index.js";
import { makeCtx, makeState } from "./fakes.js";

function stateWith(over = {}) {
  return makeState({ config: { ...DEFAULT_CONFIG, model: "openrouter-soukr/some/model", ...over } });
}

function chipText(state, ctx = makeCtx()) {
  paintChip(state, ctx);
  return ctx.statusCalls.at(-1);
}

function reportText(state) {
  return renderReport({ state, signals: [], history: [], lang: state.config.lang });
}

test("modelRefOf builds a reference only from a usable provider/id pair", () => {
  assert.equal(modelRefOf({ provider: "a", id: "b" }), "a/b");
  assert.equal(modelRefOf(undefined), "");
  assert.equal(modelRefOf({ provider: "", id: "b" }), "");
  assert.equal(modelRefOf({ provider: "a", id: 42 }), "");
});

test("equal models: chip and report both warn", () => {
  const state = stateWith();
  state.sessionModelRef = "openrouter-soukr/some/model";
  assert.equal(sameModelWarning(state), true);
  const chip = chipText(state);
  assert.deepEqual(chip, { id: STATUS_ID, text: "psych 0t · 0/12 · same model" });
  assert.match(reportText(state), /the observer is the same model as the working agent/);
});

test("different models: no warning anywhere", () => {
  const state = stateWith();
  state.sessionModelRef = "openrouter-soukr/other/model";
  assert.equal(sameModelWarning(state), false);
  assert.equal(chipText(state).text, "psych 0t · 0/12");
  assert.doesNotMatch(reportText(state), /same model as the working agent/);
});

test("unknown session model: absent, and the chip never throws", () => {
  const state = stateWith();
  state.sessionModelRef = "";
  const ctx = makeCtx(); // no `model` — headless / context without one
  assert.equal(sameModelWarning(state), false);
  assert.equal(chipText(state, ctx).text, "psych 0t · 0/12");
  assert.doesNotMatch(reportText(state), /same model as the working agent/);
});

test("paintChip captures the working model from the context when it exposes one", () => {
  const state = stateWith();
  const ctx = makeCtx({ model: { provider: "openrouter-soukr", id: "some/model" } });
  chipText(state, ctx);
  assert.equal(state.sessionModelRef, "openrouter-soukr/some/model");
  assert.equal(chipText(state).text, "psych 0t · 0/12 · same model");
});

test("the agent runtime compares against the effective agent model", () => {
  const state = stateWith({ runtime: "agent", model: "shared/model", agent: { ...DEFAULT_CONFIG.agent, model: "child/model" } });
  state.sessionModelRef = "child/model";
  assert.equal(sameModelWarning(state), true);
  state.sessionModelRef = "shared/model";
  assert.equal(sameModelWarning(state), false);
});
