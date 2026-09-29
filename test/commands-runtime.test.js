/**
 * `/psych runtime`, `/psych context`, `/psych agent-model` — the switch's completions and handlers.
 *
 * The completion contract is the workshop's Trailing Space Contract, and every assertion here is a
 * bug that only shows up on Tab: a leaf takes no space, a branch does, a fully-typed branch already
 * offers its children, and the value in effect is marked in the label (`✓`) and the description
 * (`· ●`). The consent levels add one rule of their own: `digest`/`fork` are a persisted decision,
 * so a non-terminal context has nobody to confirm it and must refuse rather than widen the boundary.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  completePsych,
  GLOBAL_FLAG,
  registerPsychCommand,
} from "../src/slices/commands/index.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { stringsFor } from "../src/shared/i18n.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

function stateWith(over = {}, agentOver = {}) {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, ...over, agent: { ...DEFAULT_CONFIG.agent, ...agentOver } };
  return state;
}

const labels = (items) => items.map((item) => item.label);
const find = (items, label) =>
  items.find((item) => item.label === label || item.label === label + " ✓");

function registered(state) {
  const pi = makePi();
  const saved = [];
  registerPsychCommand(pi, state, {
    now: async () => "done",
    report: () => {},
    effect: () => {},
    save: (patch, isGlobal) => {
      saved.push({ patch, isGlobal });
      return "/tmp/config.json";
    },
    reload: () => {},
  });
  return { pi, saved, def: pi.commands.get("psych") };
}

test("the subcommand menu offers the three switch commands with a trailing space and the value in effect", () => {
  const items = completePsych(stateWith({ runtime: "agent" }, { context: "digest" }), "");
  assert.equal(find(items, "runtime").value, "runtime ", "a branch takes further arguments");
  assert.equal(find(items, "context").value, "context ");
  assert.equal(find(items, "agent-model").value, "agent-model ");
  assert.match(find(items, "runtime").description, /●/, "the parent names the runtime in effect");
  assert.match(find(items, "runtime").description, /agent/);
  assert.match(find(items, "context").description, /digest/);
});

test("runtime offers its two modes as soon as the token is typed, with the active one ticked and both meanings shown", () => {
  const items = completePsych(stateWith({ runtime: "agent" }), "runtime");
  assert.deepEqual(labels(items), ["api", "agent ✓"]);
  assert.deepEqual(items.map((item) => item.value), ["runtime api", "runtime agent"]);
  assert.match(find(items, "agent").description, /●/);
  // Every row carries its plain-word meaning — the point of the descriptions: a new user can
  // choose between api and agent without leaving the menu or reading the README.
  assert.match(find(items, "agent").description, /child pi|tools/, "the active row keeps its meaning");
  assert.match(find(items, "api").description, /one model call|cheapest/, "the inactive row explains itself too");
});

test("context offers its three levels at the token and after the space, with the active one ticked", () => {
  const lazy = completePsych(stateWith({}, { context: "evidence" }), "context");
  assert.deepEqual(labels(lazy), ["evidence ✓", "digest", "fork"]);
  assert.deepEqual(lazy.map((item) => item.value), ["context evidence", "context digest", "context fork"]);
  assert.match(find(lazy, "evidence").description, /●/);
  const spaced = completePsych(stateWith({}, { context: "fork" }), "context ");
  assert.deepEqual(labels(spaced), ["evidence", "digest", "fork ✓"]);
});

test("a settled runtime or context offers the trailing --global flag with the whole prefix", () => {
  assert.deepEqual(completePsych(stateWith(), "runtime agent ").map((i) => i.value), [
    `runtime agent ${GLOBAL_FLAG}`,
  ]);
  assert.deepEqual(completePsych(stateWith(), "context fork ").map((i) => i.value), [
    `context fork ${GLOBAL_FLAG}`,
  ]);
});

test("agent-model reuses the registry picker under its own head and ticks the effective model", () => {
  const state = stateWith({}, { model: "openrouter-soukr/deepseek/deepseek-v4.1-flash" });
  state.modelProviders = ["openrouter-default", "openrouter-soukr"];
  state.modelCatalog = [
    "openrouter-default/anthropic/claude-sonnet-4-5",
    "openrouter-soukr/deepseek/deepseek-v4.1-flash",
  ];
  const providers = completePsych(state, "agent-model");
  assert.deepEqual(labels(providers), ["openrouter-default", "openrouter-soukr ✓"]);
  assert.deepEqual(providers.map((item) => item.value), [
    "agent-model openrouter-default/",
    "agent-model openrouter-soukr/",
  ]);
  const models = completePsych(state, "agent-model openrouter-soukr/");
  assert.deepEqual(models.map((item) => item.value), [
    "agent-model openrouter-soukr/deepseek/deepseek-v4.1-flash",
  ]);
  assert.equal(models[0].label, "deepseek/deepseek-v4.1-flash ✓");
  assert.match(models[0].description, /●/);
});

test("runtime api|agent is persisted to the chosen layer", async () => {
  const state = stateWith({ runtime: "api" });
  const { def, saved } = registered(state);
  await def.handler("runtime agent", makeCtx());
  assert.equal(state.config.runtime, "agent");
  assert.deepEqual(saved, [{ patch: { runtime: "agent" }, isGlobal: false }]);
  await def.handler("runtime api --global", makeCtx());
  assert.equal(state.config.runtime, "api");
  assert.deepEqual(saved[1], { patch: { runtime: "api" }, isGlobal: true });
});

test("an invalid runtime warns and changes nothing", async () => {
  const state = stateWith({ runtime: "api" });
  const { def, saved } = registered(state);
  const ctx = makeCtx();
  await def.handler("runtime child", ctx);
  assert.equal(state.config.runtime, "api");
  assert.equal(saved.length, 0);
  assert.equal(ctx.notes[0].level, "warning");
});

test("selecting evidence needs no confirmation: it is the boundary the plugin already has", async () => {
  const state = stateWith({}, { context: "fork" });
  const { def, saved } = registered(state);
  const ctx = makeCtx();
  await def.handler("context evidence", ctx);
  assert.equal(state.config.agent.context, "evidence");
  assert.deepEqual(saved, [{ patch: { agent: { context: "evidence" } }, isGlobal: false }]);
  assert.equal(ctx.notes.at(-1).message, stringsFor("en").contextSet("evidence"));
});

test("selecting fork in a TUI opens a confirm stating what leaves the machine", async () => {
  const state = stateWith();
  const { def, saved } = registered(state);
  const ctx = makeCtx();
  let asked = 0;
  ctx.ui.confirm = async (title, message) => {
    asked += 1;
    assert.equal(title, stringsFor("en").contextConfirmTitle);
    assert.match(message, /entire session/i, "the body names the consequence");
    return true;
  };
  await def.handler("context fork", ctx);
  assert.equal(asked, 1);
  assert.equal(state.config.agent.context, "fork");
  assert.deepEqual(saved, [{ patch: { agent: { context: "fork" } }, isGlobal: false }]);
});

test("a refused confirm writes nothing, so consent is never assumed", async () => {
  const state = stateWith();
  const { def, saved } = registered(state);
  const ctx = makeCtx();
  ctx.ui.confirm = async () => false;
  await def.handler("context digest", ctx);
  assert.equal(state.config.agent.context, "evidence", "the level is unchanged");
  assert.equal(saved.length, 0, "and nothing was persisted");
});

test("outside a TUI, digest and fork are refused with a pointer to the config file", async () => {
  const state = stateWith();
  const { def, saved } = registered(state);
  const ctx = makeCtx({ mode: "json" });
  await def.handler("context fork", ctx);
  assert.equal(state.config.agent.context, "evidence");
  assert.equal(saved.length, 0);
  assert.equal(ctx.notes.at(-1).level, "warning");
  assert.equal(ctx.notes.at(-1).message, stringsFor("en").contextNeedsTui);
});

test("agent-model persists a nested patch and refuses an empty value", async () => {
  const state = stateWith();
  const { def, saved } = registered(state);
  const ctx = makeCtx();
  await def.handler("agent-model openrouter-soukr/x/y", ctx);
  assert.equal(state.config.agent.model, "openrouter-soukr/x/y");
  assert.deepEqual(saved, [{ patch: { agent: { model: "openrouter-soukr/x/y" } }, isGlobal: false }]);
  await def.handler("agent-model", ctx);
  assert.equal(state.config.agent.model, "openrouter-soukr/x/y", "an empty value must not clear it");
  assert.equal(saved.length, 1);
});
