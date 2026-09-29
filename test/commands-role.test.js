/**
 * `/psych role` — the consent-gate command, and the per-leaf config merge it depends on.
 *
 * The complaint this answers: a role gate that could only be enabled by editing a JSON file made
 * the operator study the config schema before using the feature. So the contract here is:
 *   - `/psych role` lists both gates with their states;
 *   - `/psych role scout on` flips the gate, persists it, and reloads;
 *   - the persisted patch is a NESTED partial — `{ roles: { scout: { enabled } } } }` — and the
 *     merge must keep the sibling role and the role's own other keys (per-leaf merge, any depth);
 *   - a bad role or state is a warning naming what exists;
 *   - the refusal notices of the roles name the command, not the config file.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { completePsych, registerPsychCommand } from "../src/slices/commands/index.js";
import { DEFAULT_CONFIG, loadConfig } from "../src/shared/config.js";
import { stringsFor } from "../src/shared/i18n.js";
import { makeCtx, makePi, makeState } from "./fakes.js";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function stateWith(over = {}) {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, roles: { ...DEFAULT_CONFIG.roles, ...over.roles }, ...over };
  return state;
}

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

const labels = (items) => items.map((item) => item.label);

test("bare /psych role lists both gates with their states", async () => {
  const state = stateWith({ roles: { scout: { enabled: true, workshopDir: "" }, reviewer: { enabled: false, model: "", maxDiffBytes: 1, conventionFiles: [] } } });
  const { def } = registered(state);
  const ctx = makeCtx();
  await def.handler("role", ctx);
  const text = ctx.notes[0].message;
  assert.match(text, /scout: on/);
  assert.match(text, /reviewer: off/);
});

test("/psych role scout on flips the gate and persists a nested partial patch", async () => {
  const state = stateWith();
  const { def, saved, reloaded } = registered(state);
  const ctx = makeCtx();
  await def.handler("role scout on", ctx);
  assert.equal(state.config.roles.scout.enabled, true, "the gate flipped in memory");
  assert.deepEqual(saved[0].patch, { roles: { scout: { enabled: true } } }, "a NESTED partial, not the whole roles object");
  assert.equal(saved[0].isGlobal, false, "project layer by default");
  assert.equal(reloaded.length, 1);
  await def.handler("role scout off", ctx);
  assert.equal(state.config.roles.scout.enabled, false);
});

test("the sibling role and the role's other keys survive the nested patch merge", () => {
  // The regression the recursive mergeLayer guards: a one-level-deep merge would replace the
  // whole `roles` object and silently lose `roles.reviewer` and `roles.scout.workshopDir`.
  const cwd = mkdtempSync(join(tmpdir(), "psych-role-"));
  try {
    const globalFile = join(cwd, "global.json");
    writeFileSync(
      globalFile,
      JSON.stringify({ ...DEFAULT_CONFIG, roles: { scout: { enabled: false, workshopDir: "W" }, reviewer: { enabled: false, model: "p/m", maxDiffBytes: 1, conventionFiles: [] } } }),
      "utf8",
    );
    // Simulate what save + reload do: a project layer with only the gate leaf.
    const projectFile = join(cwd, ".pi", "pi-devs-psychologist.json");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(projectFile, JSON.stringify({ roles: { scout: { enabled: true } } }), "utf8");
    const merged = loadConfig(cwd, globalFile);
    assert.equal(merged.roles.scout.enabled, true, "the leaf the project layer speaks to");
    assert.equal(merged.roles.scout.workshopDir, "W", "the scout's own other key survives");
    assert.equal(merged.roles.reviewer.enabled, false, "the sibling role survives");
    assert.equal(merged.roles.reviewer.model, "p/m", "the sibling's nested keys survive");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a bad role or state is a warning naming what exists", async () => {
  const { def } = registered(stateWith());
  for (const bad of ["role moel on", "role scout sideways"]) {
    const ctx = makeCtx();
    await def.handler(bad, ctx);
    assert.equal(ctx.notes[0].level, "warning", bad);
    assert.match(ctx.notes[0].message, /scout on|reviewer/);
  }
});

test("the picker offers role with per-state leaves marked by the gate in effect", () => {
  const state = stateWith();
  // Defaults: both gates off, so the `off` leaves are the active ones.
  const items = completePsych(state, "role");
  assert.deepEqual(labels(items), ["scout on", "scout off ✓", "reviewer on", "reviewer off ✓"]);
  const scoutOn = items[0];
  assert.match(scoutOn.description, /scout/);
  assert.equal(completePsych(state, "role sc").length, 2, "a partial filters both states of the role");
});

test("the empty menu offers role with the picker description", () => {
  const items = completePsych(stateWith(), "");
  const role = items.find((item) => item.label === "role");
  assert.ok(role, "role is offered at the top level");
  assert.equal(role.value, "role ");
  assert.equal(role.description, stringsFor("en").cmdRole);
});

test("the refusal notices name the command, not the config file", () => {
  assert.match(stringsFor("en").scoutDisabled, /\/psych role scout on/);
  assert.match(stringsFor("en").reviewDisabled, /\/psych role reviewer on/);
  assert.match(stringsFor("cs").scoutDisabled, /\/psych role scout on/);
});
