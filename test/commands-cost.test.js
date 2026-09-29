/**
 * Cost preview in the model picker (idea 4) — the estimate, its absence, and the width cap.
 *
 * The picker is where the operator chooses what the observer spends; a price that is invented
 * is worse than no price, so the unknown case and the known case are asserted side by side.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, normalizeConfig } from "../src/shared/config.js";
import { appraisalCostUsd, DEFAULT_ESTIMATE_TOKENS } from "../src/shared/cost.js";
import { refreshModelCatalog } from "../src/shared/model-catalog.js";
import { modelCompletions } from "../src/slices/commands/completions.js";
import { makeState } from "./fakes.js";

function registry(models) {
  return { getAvailable: () => models, getAll: () => models };
}

function stateWith(models, over = {}) {
  const state = makeState({ config: { ...DEFAULT_CONFIG, ...over } });
  refreshModelCatalog(state, registry(models));
  return state;
}

test("appraisalCostUsd is arithmetic over per-million rates, and undefined when unknown", () => {
  // 1500/1e6*3 + 400/1e6*15 = 0.0045 + 0.006 = 0.0105
  assert.equal(appraisalCostUsd({ input: 3, output: 15 }, DEFAULT_ESTIMATE_TOKENS), 0.0105);
  assert.equal(appraisalCostUsd({ input: 0, output: 0 }, DEFAULT_ESTIMATE_TOKENS), 0);
  assert.equal(appraisalCostUsd(undefined, DEFAULT_ESTIMATE_TOKENS), undefined);
  assert.equal(appraisalCostUsd({ input: 3 }, DEFAULT_ESTIMATE_TOKENS), undefined);
  assert.equal(appraisalCostUsd({ input: "x", output: 15 }, DEFAULT_ESTIMATE_TOKENS), undefined);
});

test("a known cost renders the estimated per-appraisal price", () => {
  const state = stateWith([{ provider: "acme", id: "model", cost: { input: 3, output: 15 } }]);
  const items = modelCompletions(state, "acme/");
  const item = items.find((i) => i.label === "model");
  assert.match(item.description, /\(~\$0\.01 per appraisal\)/);
});

test("an unknown price says so, never a guess", () => {
  const state = stateWith([{ provider: "acme", id: "freeish" }]);
  const items = modelCompletions(state, "acme/");
  const item = items.find((i) => i.label === "freeish");
  assert.match(item.description, /price unknown/);
  assert.doesNotMatch(item.description, /\$/);
});

test("the ✓/ACTIVE annotation survives next to the price", () => {
  const state = stateWith([{ provider: "acme", id: "model", cost: { input: 3, output: 15 } }], {
    model: "acme/model",
  });
  const items = modelCompletions(state, "acme/");
  const item = items.find((i) => i.label.startsWith("model"));
  assert.equal(item.label, "model ✓");
  assert.match(item.description, /current/);
  assert.match(item.description, /per appraisal/);
});

test("no item's description exceeds 200 characters", () => {
  const models = Array.from({ length: 60 }, (_, n) => ({
    provider: "a-really-long-provider-name-here",
    id: `a-really-long-model-identifier-${n}`,
    cost: { input: 123.456, output: 654.321 },
  }));
  const state = stateWith(models, { model: "a-really-long-provider-name-here/a-really-long-model-identifier-3" });
  const items = modelCompletions(state, "a-really-long-provider-name-here/");
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.ok((item.description ?? "").length <= 200, `description too long: ${item.description}`);
  }
});

test("estimateTokens normalises per key, and the estimate uses it", () => {
  assert.deepEqual(DEFAULT_CONFIG.estimateTokens, DEFAULT_ESTIMATE_TOKENS);
  assert.deepEqual(normalizeConfig({ estimateTokens: { input: 10, output: 20 } }).estimateTokens, {
    input: 10,
    output: 20,
  });
  // Junk falls back per key rather than losing both.
  assert.deepEqual(normalizeConfig({ estimateTokens: { input: -5, output: "x" } }).estimateTokens, DEFAULT_ESTIMATE_TOKENS);
  const state = stateWith([{ provider: "acme", id: "model", cost: { input: 1_000, output: 1_000 } }], {
    estimateTokens: { input: 1_000, output: 0 },
  });
  const item = modelCompletions(state, "acme/").find((i) => i.label === "model");
  // 1000/1e6*1000 = 1.00
  assert.match(item.description, /\(~\$1\.00 per appraisal\)/);
});
