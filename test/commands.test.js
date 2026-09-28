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
import { completePsych, GLOBAL_FLAG, parseArgs, registerPsychCommand } from "../src/slices/commands/index.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { stringsFor } from "../src/shared/i18n.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

function stateWith(over = {}) {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, model: "", ...over };
  return state;
}

const labels = (items) => items.map((item) => item.label);
const find = (items, label) => items.find((item) => item.label === label);

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
  const lazy = completePsych(stateWith(), "lang");
  assert.deepEqual(labels(lazy), ["en", "cs"]);
  assert.deepEqual(lazy.map((item) => item.value), ["lang en", "lang cs"], "the full prefix is replaced");
});

test("lang filters by the partial value and marks the one in effect", () => {
  const all = completePsych(stateWith({ lang: "cs" }), "lang ");
  assert.deepEqual(labels(all), ["en", "cs"]);
  assert.match(find(all, "cs").description, /●/, "the active locale is marked");
  assert.equal(find(all, "en").description, undefined, "the inactive locale carries no marker")
  assert.deepEqual(labels(completePsych(stateWith(), "lang e")), ["en"]);
});

test("the settings menu shows the value actually in effect", () => {
  const items = completePsych(stateWith({ model: "a/b", maxAppraisalsPerSession: 5, enabled: false }), "");
  assert.equal(find(items, "model").description, "a/b");
  assert.equal(find(items, "budget").description, "5");
  assert.match(find(items, "off").description, /●/, "off is marked because it is the current state");
  assert.doesNotMatch(find(items, "on").description, /●/);
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

test("a free-text parameter is not guessed at", () => {
  assert.equal(completePsych(stateWith(), "model openrouter-soukr/"), null);
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
