/**
 * `/psych model` — the registry-driven picker, split out of `commands.test.js` by concept
 * (and to keep both files under the line budget).
 *
 * Every assertion here is a Tab bug: a provider list reachable only after a space is unreachable
 * (the engine switches to file completion once a space exists), a silently truncated list hides
 * models, and a `✓` that leaks into `value` corrupts the command because `value` is inserted
 * verbatim.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { completePsych, MODEL_PICKER_CAP } from "../src/slices/commands/index.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { makeState } from "./fakes.js";

function stateWith(over = {}) {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, model: "", ...over };
  return state;
}

const labels = (items) => items.map((item) => item.label);
const find = (items, label) =>
  items.find((item) => item.label === label || item.label === label + " ✓");

/** A state whose cached catalog looks like a multi-account OpenRouter setup. */
function catalogState(over = {}) {
  const state = stateWith(over);
  state.modelProviders = ["openrouter-default", "openrouter-soukr"];
  state.modelCatalog = [
    "openrouter-default/anthropic/claude-sonnet-4-5",
    "openrouter-default/openai/gpt-5",
    "openrouter-soukr/cohere/north-mini-code:free",
    "openrouter-soukr/deepseek/deepseek-v4.1-flash",
  ];
  return state;
}

test("a fully-typed model offers its providers WITHOUT waiting for a space", () => {
  // The trap this guards: Tab-confirming `model ` closes the picker and typing a space switches
  // the engine to FILE completion, so a provider list reachable only after the space is
  // unreachable by Tab altogether. references/command-completions.md marks this mandatory.
  const items = completePsych(catalogState(), "model");
  assert.deepEqual(labels(items), ["openrouter-default", "openrouter-soukr"]);
  assert.deepEqual(items.map((item) => item.value), ["model openrouter-default/", "model openrouter-soukr/"]);
});

test("with no catalog the picker defers to the engine, so a hand-typed ref still works", () => {
  // The cache is empty before the first session start, and a registry that answers nothing must
  // not turn into a broken picker — free text keeps working, which is also what makes the flag
  // completion reachable after a hand-typed value.
  assert.equal(completePsych(stateWith(), "model openrouter-soukr/"), null);
});

test("the first level offers the registered providers, each one Tab from its models", () => {
  // Multi-account support falls out of this for free: pi-openrouter-accounts registers each
  // OpenRouter account as its own provider id, so listing providers IS listing accounts.
  const items = completePsych(catalogState(), "model ");
  assert.deepEqual(labels(items), ["openrouter-default", "openrouter-soukr"]);
  // No trailing space: the model id continues the same token.
  assert.deepEqual(items.map((item) => item.value), ["model openrouter-default/", "model openrouter-soukr/"]);
});

test("filtering level one by a partial account name, including from the middle", () => {
  // Substring, not prefix: the account is called `soukr` while its provider id is
  // `openrouter-soukr`, and an operator should not have to know the prefix to find it.
  assert.deepEqual(labels(completePsych(catalogState(), "model soukr")), [
    "openrouter-soukr",
    "openrouter-soukr/cohere/north-mini-code:free",
    "openrouter-soukr/deepseek/deepseek-v4.1-flash",
  ]);
  assert.deepEqual(labels(completePsych(catalogState(), "model openrouter-s")), [
    "openrouter-soukr",
    "openrouter-soukr/cohere/north-mini-code:free",
    "openrouter-soukr/deepseek/deepseek-v4.1-flash",
  ]);
  // And the same for a model name buried inside a reference.
  assert.deepEqual(labels(completePsych(catalogState(), "model claude")), [
    "openrouter-default/anthropic/claude-sonnet-4-5",
  ]);
});

test("a settled provider lists only its own models, as full references", () => {
  const items = completePsych(catalogState(), "model openrouter-soukr/");
  assert.deepEqual(labels(items), ["cohere/north-mini-code:free", "deepseek/deepseek-v4.1-flash"]);
  assert.deepEqual(items.map((item) => item.value), [
    "model openrouter-soukr/cohere/north-mini-code:free",
    "model openrouter-soukr/deepseek/deepseek-v4.1-flash",
  ]);
  assert.ok(!items.some((item) => item.label.includes("claude")), "another account's models stay out");
});

test("a provider that is not in the registry is never offered", () => {
  assert.equal(completePsych(catalogState(), "model openrouter-nonsense/"), null);
});

test("a partial reference narrows, and a slash keeps the provider in play", () => {
  const deep = completePsych(catalogState(), "model openrouter-soukr/deep");
  // A partial reference is matched against the whole path, so the label is the whole path.
  assert.deepEqual(labels(deep), ["openrouter-soukr/deepseek/deepseek-v4.1-flash"]);
  const any = completePsych(catalogState(), "model openrouter-default/");
  assert.equal(any.length, 2);
  // A reference that matches nothing defers rather than inventing one.
  assert.equal(completePsych(catalogState(), "model openrouter-soukr/zzz"), null);
});

test("the model in effect is marked, at its own row and at its provider's row", () => {
  const state = catalogState({ model: "openrouter-soukr/deepseek/deepseek-v4.1-flash" });
  const refs = completePsych(state, "model openrouter-soukr/");
  const active = refs.find((item) => item.label === "deepseek/deepseek-v4.1-flash ✓");
  assert.match(active.description, /●/);
  assert.equal(active.value, "model openrouter-soukr/deepseek/deepseek-v4.1-flash", "value stays clean");
  // Every model row now carries a price (or says it is unknown); the fake catalog has no rates.
  assert.match(refs.find((item) => item.label === "cohere/north-mini-code:free").description, /price unknown/);
  // The parent level shows it too, so the current value is visible without descending.
  const providers = completePsych(state, "model ");
  assert.match(find(providers, "openrouter-soukr").description, /●/);
  assert.equal(find(providers, "openrouter-soukr").label, "openrouter-soukr ✓");
  assert.equal(find(providers, "openrouter-default").description, undefined);
});

test("a large catalog is capped and says how much it hid", () => {
  // A silent truncation would hide models with no way to tell; a 400-row picker would be the
  // nagging this plugin exists to avoid.
  const state = catalogState();
  state.modelCatalog = Array.from({ length: 120 }, (_, i) => "openrouter-soukr/model-" + String(i).padStart(3, "0"));
  const items = completePsych(state, "model openrouter-soukr/");
  assert.equal(items.length, MODEL_PICKER_CAP + 1);
  const remainder = items.at(-1);
  assert.match(remainder.label, /70 more/);
  // The overflow row is UI copy like everything else, so it comes from the locale table.
  const cs = { ...state, config: { ...state.config, lang: "cs" } };
  assert.match(completePsych(cs, "model openrouter-soukr/").at(-1).label, /dalších 70/);
  // Selecting the remainder must change nothing: it re-inserts what is already typed.
  assert.equal(remainder.value, "model openrouter-soukr/");
});

test("the --global flag still follows a model chosen from the registry", () => {
  const items = completePsych(catalogState(), "model openrouter-soukr/deepseek/deepseek-v4.1-flash ");
  assert.deepEqual(items.map((item) => item.value), [
    "model openrouter-soukr/deepseek/deepseek-v4.1-flash --global",
  ]);
});