/**
 * `/psych help` — the setup help.
 *
 * The complaint this answers: a new user facing `/psych` does not know what each setting IS or
 * what HAPPENS after it is set. So the contract here is:
 *   - bare `/psych help` lists every setup item with the value in effect;
 *   - `/psych help <item>` returns the item's full text, which names the post-set effect;
 *   - an unknown item is a warning that lists the items that exist;
 *   - the picker offers `help` and its topics with the one-liner as the description;
 *   - help never saves, never reloads, never touches the budget.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { completePsych, registerPsychCommand } from "../src/slices/commands/index.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { stringsFor } from "../src/shared/i18n.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

function stateWith(over = {}) {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, ...over };
  return state;
}

const labels = (items) => items.map((item) => item.label);

function registered(state) {
  const pi = makePi();
  const saved = [];
  const reloaded = [];
  registerPsychCommand(pi, state, {
    now: async () => "done",
    report: () => {},
    stop: () => "",
    effect: () => {},
    history: () => "",
    ask: async () => "",
    scout: async () => "",
    review: async () => "",
    replay: async () => "",
    save: (patch, isGlobal) => {
      saved.push({ patch, isGlobal });
      return "/tmp/config.json";
    },
    reload: () => reloaded.push(1),
  });
  return { saved, reloaded, def: pi.commands.get("psych") };
}

test("the empty menu offers help as a non-terminal with the picker description", () => {
  const items = completePsych(stateWith(), "");
  const help = items.find((item) => item.label === "help");
  assert.ok(help, "help is offered in the top-level menu");
  assert.equal(help.value, "help ", "trailing space: it takes an optional topic");
  assert.match(help.description, /what it is/, "the description says what the subcommand does");
});

test("typing `help` lists the topics lazily, each described by its own one-liner", () => {
  const s = stringsFor("en");
  const items = completePsych(stateWith(), "help");
  assert.deepEqual(labels(items), [...s.helpTopics], "every topic is offered without the space");
  for (const item of items) {
    assert.match(item.value, /^help /, "the value carries the parent path");
    assert.equal(item.description, s.helpLine[item.label], "the one-liner is the description");
  }
});

test("a partial topic filters the lazy list", () => {
  assert.deepEqual(labels(completePsych(stateWith(), "help mo")), ["model"]);
});

test("after a space with no topic, the full topic list is offered", () => {
  const items = completePsych(stateWith(), "help ");
  assert.deepEqual(labels(items), [...stringsFor("en").helpTopics]);
});

test("bare /psych help lists every topic with the value in effect", async () => {
  const state = stateWith({ model: "a/b", maxAppraisalsPerSession: 5, enabled: false });
  const { def, saved, reloaded } = registered(state);
  const ctx = makeCtx();
  await def.handler("help", ctx);
  const text = ctx.notes[0].message;
  assert.ok(text.includes(stringsFor("en").helpTitle), "the header is there");
  for (const topic of stringsFor("en").helpTopics) {
    assert.ok(text.includes(topic), `the listing names ${topic}`);
  }
  assert.match(text, /a\/b/, "the model row shows the model in effect");
  assert.match(text, /\(not set\)/, "an unset agent-model says so instead of a bare dash");
  assert.deepEqual(saved, [], "help never saves");
  assert.deepEqual(reloaded, [], "help never reloads");
});

test("/psych help <item> returns the item's full text, which names the post-set effect", async () => {
  const { def } = registered(stateWith());
  for (const topic of stringsFor("en").helpTopics) {
    const ctx = makeCtx();
    await def.handler(`help ${topic}`, ctx);
    const text = ctx.notes[0].message;
    assert.match(text, /AFTER YOU SET IT/, `the ${topic} text answers "what happens after"`);
    assert.match(text, /CHECK:/, `the ${topic} text says how to verify it took`);
  }
});

test("the detail text for model states the zero-spend default and the reference format", async () => {
  const { def } = registered(stateWith());
  const ctx = makeCtx();
  await def.handler("help model", ctx);
  const text = ctx.notes[0].message;
  assert.match(text, /provider\/modelId/, "the reference format is named");
  assert.match(text, /zero model spend/, "the empty-model default is stated");
});

test("an unknown item is a warning that lists the items that exist", async () => {
  const { def } = registered(stateWith());
  const ctx = makeCtx();
  await def.handler("help moel", ctx);
  assert.equal(ctx.notes[0].level, "warning");
  assert.match(ctx.notes[0].message, /Unknown help item: moel/);
  assert.match(ctx.notes[0].message, /model \| budget/, "the correctable list is in the message");
});

test("the cs table answers in Czech with the same topics", async () => {
  const state = stateWith({ lang: "cs" });
  const { def } = registered(state);
  const ctx = makeCtx();
  await def.handler("help model", ctx);
  assert.match(ctx.notes[0].message, /PO NASTAVENÍ/, "the post-set section is translated");
  const items = completePsych(state, "help");
  assert.deepEqual(labels(items), [...stringsFor("cs").helpTopics], "same topic list");
  assert.match(items[0].description, /model pozorovatele/, "the one-liner is translated");
});
