/**
 * `/psych` — the completion contract and the settings handlers.
 *
 * The completion rules are the workshop's Trailing Space Contract, and each is a bug that only
 * shows up on Tab:
 *   - a non-terminal choice carries a trailing space (Tab confirms and offers the next level);
 *   - a terminal leaf does not;
 *   - `item.value` replaces the *whole* argument text, so nested values carry their parent path;
 *   - a subcommand with enumerable parameters offers them as soon as the token is typed, not only
 *     after the space;
 *   - the settings menu shows the value in effect.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
	completePsych,
	GLOBAL_FLAG,
	MODEL_PICKER_CAP,
	parseArgs,
	registerPsychCommand,
} from "../src/slices/commands/index.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { stringsFor } from "../src/shared/i18n.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

function stateWith(over = {}) {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, model: "", ...over };
  return state;
}

const labels = (items) => items.map((item) => item.label);
// The active row carries a tick in `label` (the primary column) per the completion reference,
// so lookups accept both the plain and the decorated form.
const find = (items, label) =>
  items.find((item) => item.label === label || item.label === label + " ✓");

test("an empty argument offers every subcommand with the contract's trailing space", () => {
  const items = completePsych(stateWith(), "");
  assert.ok(items.length >= 7);
  // A leaf takes no arguments: no trailing space, so Tab confirms it as final.
  assert.equal(find(items, "status").value, "status");
  assert.equal(find(items, "now").value, "now");
  // These take a value, and `on`/`off` take the optional --global flag.
  assert.equal(find(items, "model").value, "model ");
  assert.equal(find(items, "budget").value, "budget ");
  assert.equal(find(items, "lang").value, "lang ");
  assert.equal(find(items, "on").value, "on ");
  assert.equal(find(items, "off").value, "off ");
});

test("a partial token filters, and a token that matches nothing defers to the engine", () => {
  assert.deepEqual(labels(completePsych(stateWith(), "st")), ["status"]);
  assert.equal(completePsych(stateWith(), "zzz"), null, "null, not [], so file completion still works");
});

test("lang offers its parameters as soon as the token is typed, without waiting for the space", () => {
  // Tab closes the picker and switches to file completion once a space exists, so a
  // trailing-space-only form strands the user.
  const lazy = completePsych(stateWith({ lang: "en" }), "lang");
  assert.deepEqual(labels(lazy), ["en ✓", "cs"], "the active locale is ticked in the label");
  assert.deepEqual(lazy.map((item) => item.value), ["lang en", "lang cs"], "the full prefix is replaced");
});

test("lang filters by the partial value and marks the one in effect", () => {
  const all = completePsych(stateWith({ lang: "cs" }), "lang ");
  assert.deepEqual(labels(all), ["en", "cs ✓"]);
  assert.match(find(all, "cs").description, /●/, "the active locale is marked");
  assert.equal(find(all, "en").description, undefined, "the inactive locale carries no marker");
  assert.deepEqual(labels(completePsych(stateWith({ lang: "en" }), "lang e")), ["en ✓"]);
});

test("the settings menu shows the value actually in effect", () => {
  const items = completePsych(stateWith({ model: "a/b", maxAppraisalsPerSession: 5, enabled: false }), "");
  assert.equal(find(items, "model").description, "a/b");
  assert.equal(find(items, "budget").description, "5");
  // The marker sits in both columns: `✓` in the label to be visible at a glance, the text form
  // in the description. `value` stays clean, because it is inserted verbatim.
  assert.match(find(items, "off").description, /●/, "off is marked because it is the current state");
  assert.equal(find(items, "off").label, "off ✓");
  // The inactive row carries no marker but keeps its own label text.
  assert.equal(find(items, "on").label, "on");
  assert.doesNotMatch(find(items, "on").description, /●/);
  assert.equal(find(items, "on").description, stringsFor("en").enabled);
  assert.equal(find(items, "off").value, "off ", "the tick never reaches the inserted value");
});

test("an unlimited budget is shown as infinity, not as 0", () => {
  const items = completePsych(stateWith({ maxAppraisalsPerSession: 0 }), "");
  assert.equal(find(items, "budget").description, "∞");
});

test("the --global flag is offered after a settled value, with the whole prefix", () => {
  const items = completePsych(stateWith(), "model a/b ");
  assert.equal(items.length, 1);
  assert.equal(items[0].label, GLOBAL_FLAG);
  // `value` replaces everything after `/psych `, so it must carry the value it follows.
  assert.equal(items[0].value, `model a/b ${GLOBAL_FLAG}`);
});

test("the --global flag is offered while a dash is being typed, and never in place of a value", () => {
  const half = completePsych(stateWith(), "budget 5 -");
  assert.equal(half[0].value, `budget 5 ${GLOBAL_FLAG}`);
  assert.equal(completePsych(stateWith(), "budget 5"), null, "no flag offered before the value is settled");
  assert.equal(completePsych(stateWith(), "status "), null, "status takes no flag");
});

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
  // The account row leads, and its models follow in the same list: picking the account descends
  // into it, picking a model finishes the value. Both are wanted, so both are offered.
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
  assert.equal(refs.find((item) => item.label === "cohere/north-mini-code:free").description, undefined);
  // The parent level shows it too, so the current value is visible without descending.
  const providers = completePsych(state, "model ");
  // The provider holding the current model is ticked too, so the value is visible one level up.
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

test("a hand-typed model ref is accepted, because completion is a convenience not a gate", async () => {
  const state = catalogState();
  const { def, saved } = registered(state);
  await def.handler("model some/provider/i-typed-myself", makeCtx());
  assert.equal(state.config.model, "some/provider/i-typed-myself");
  assert.equal(saved.length, 1);
});

test("parseArgs takes the flag from anywhere and defaults to status", () => {
  assert.deepEqual(parseArgs(""), { sub: "status", value: "", isGlobal: false });
  assert.deepEqual(parseArgs("  "), { sub: "status", value: "", isGlobal: false });
  assert.deepEqual(parseArgs("model"), { sub: "model", value: "", isGlobal: false });
  assert.deepEqual(parseArgs("model a/b"), { sub: "model", value: "a/b", isGlobal: false });
  assert.deepEqual(parseArgs("model a/b --global"), { sub: "model", value: "a/b", isGlobal: true });
  assert.deepEqual(parseArgs("--global off"), { sub: "off", value: "", isGlobal: true });
});

/** Register the command against a fake API and hand back the handler. */
function registered(state) {
  const pi = makePi();
  const saved = [];
  const reloaded = [];
  const deps = {
    now: async () => "done",
    report: () => {},
    save: (patch, isGlobal) => {
      saved.push({ patch, isGlobal });
      return "/tmp/config.json";
    },
    reload: () => reloaded.push(1),
  };
  registerPsychCommand(pi, state, deps);
  return { pi, saved, reloaded, def: pi.commands.get("psych") };
}

test("the command registers with the localised description and a completion source", () => {
  const { def } = registered(stateWith({ lang: "cs" }));
  assert.equal(def.description, stringsFor("cs").commandDescription);
  assert.equal(typeof def.getArgumentCompletions, "function");
});

test("status is the default, and it renders the report without saving anything", async () => {
  const state = stateWith();
  let reported = 0;
  const pi = makePi();
  registerPsychCommand(pi, state, {
    now: async () => "done",
    report: () => {
      reported += 1;
    },
    save: () => "x",
    reload: () => {},
  });
  await pi.commands.get("psych").handler("", makeCtx());
  await pi.commands.get("psych").handler("status", makeCtx());
  assert.equal(reported, 2);
});

test("an invalid value warns and changes nothing", async () => {
  const state = stateWith({ model: "keep/me", maxAppraisalsPerSession: 7, lang: "en" });
  const { def, saved } = registered(state);
  const ctx = makeCtx();

  await def.handler("model", ctx); // no value
  assert.equal(state.config.model, "keep/me", "an empty value must not clear the model");
  await def.handler("budget nonsense", ctx);
  assert.equal(state.config.maxAppraisalsPerSession, 7);
  await def.handler("budget -1", ctx);
  assert.equal(state.config.maxAppraisalsPerSession, 7);
  await def.handler("lang de", ctx);
  assert.equal(state.config.lang, "en");
  await def.handler("nonsense", ctx);

  assert.deepEqual(saved, [], "nothing was written for any of those");
  assert.equal(ctx.notes.length, 5, "and each said why");
  every_note_is_warning(ctx, 5);
});

/** Inline helper so the assertion above reads as one thought. */
function every_note_is_warning(ctx, count) {
  for (const note of ctx.notes) assert.equal(note.level, "warning");
  assert.equal(ctx.notes.length, count);
}

test("a valid setting is written to the project layer by default and reloaded", async () => {
  const state = stateWith();
  const { def, saved, reloaded } = registered(state);
  await def.handler("model openrouter-soukr/deepseek/deepseek-v4.1-flash", makeCtx());
  assert.equal(state.config.model, "openrouter-soukr/deepseek/deepseek-v4.1-flash");
  assert.deepEqual(saved, [{ patch: { model: "openrouter-soukr/deepseek/deepseek-v4.1-flash" }, isGlobal: false }]);
  assert.equal(reloaded.length, 1, "the cascade is re-read so the effect is immediate");
});

test("--global routes the same patch to the global layer", async () => {
  const state = stateWith();
  const { def, saved } = registered(state);
  await def.handler("budget 3 --global", makeCtx());
  assert.equal(state.config.maxAppraisalsPerSession, 3);
  assert.deepEqual(saved, [{ patch: { maxAppraisalsPerSession: 3 }, isGlobal: true }]);
});

test("on and off flip the switch and persist it", async () => {
  const state = stateWith({ enabled: true });
  const { def, saved } = registered(state);
  await def.handler("off", makeCtx());
  assert.equal(state.config.enabled, false);
  assert.deepEqual(saved[0], { patch: { enabled: false }, isGlobal: false });
  await def.handler("on", makeCtx());
  assert.equal(state.config.enabled, true);
});

test("budget accepts zero as unlimited, which is a real value and not a typo", async () => {
  const state = stateWith({ maxAppraisalsPerSession: 12 });
  const { def } = registered(state);
  await def.handler("budget 0", makeCtx());
  assert.equal(state.config.maxAppraisalsPerSession, 0);
});

test("a fractional budget is floored rather than stored as a fraction", async () => {
  const state = stateWith();
  const { def } = registered(state);
  await def.handler("budget 2.9", makeCtx());
  assert.equal(state.config.maxAppraisalsPerSession, 2);
});

test("now runs an appraisal and reports its outcome", async () => {
  const state = stateWith();
  const pi = makePi();
  const ctx = makeCtx();
  registerPsychCommand(pi, state, {
    now: async () => "Appraisal complete.",
    report: () => {},
    save: () => "x",
    reload: () => {},
  });
  await pi.commands.get("psych").handler("now", ctx);
  assert.deepEqual(ctx.notes, [{ message: "Appraisal complete.", level: "info" }]);
});

test("no subcommand leaks a value into the notification as an object", async () => {
  const state = stateWith();
  const { def } = registered(state);
  const ctx = makeCtx();
  await def.handler("lang cs", ctx);
  for (const note of ctx.notes) assert.equal(typeof note.message, "string");
});
