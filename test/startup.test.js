/**
 * startup — the runtime-flag override and the once-per-machine first-run welcome.
 *
 * The welcome is the out-of-box contract: a fresh install already does something useful (signals
 * live, zero spend), and the ONE line at session_start says so, names the single step that
 * changes anything, and points at /psych help. It shows exactly once per machine — the marker is
 * a companion file next to the global config, never a key inside it, so the config file stays
 * exactly the documented schema.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { applyStartupOverrides } from "../src/shared/startup.js";
import { isOnboarded, markOnboarded } from "../src/shared/config.js";
import { stringsFor } from "../src/shared/i18n.js";
import { makeState } from "./fakes.js";
import { mkdirSync, mkdtempSync, existsSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function ctxOf(notes) {
  return { hasUI: true, ui: { notify: (message, level) => notes.push({ message, level }) } };
}

test("the welcome shows on the first start and never again", () => {
  mkdirSync(join(tmpdir(), "psych-start-ignore"), { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), "psych-start-"));
  const globalFile = join(dir, "config.json");
  try {
    const state = makeState();
    state.globalFile = globalFile;
    const notes = [];
    applyStartupOverrides({ getFlag: () => undefined }, state, ctxOf(notes));
    assert.equal(notes.length, 1, "one line, not a lecture");
    assert.match(notes[0].message, /signals are live, zero model spend/, "it names the state already in effect");
    assert.match(notes[0].message, /\/psych model/, "it names the one step that changes anything");
    assert.match(notes[0].message, /\/psych help/, "it points at the full setup help");
    assert.equal(existsSync(`${globalFile}.onboarded`), true, "the marker is a companion file");
    // The config file itself stays the documented schema: no bookkeeping key inside it.
    assert.equal(existsSync(globalFile), false, "the marker never touched the config file");
    // Second start: the marker is there, so the welcome is not.
    const notes2 = [];
    applyStartupOverrides({ getFlag: () => undefined }, state, ctxOf(notes2));
    assert.equal(notes2.length, 0, "shown once per machine");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});



test("with a model already set the welcome says so instead of the setup step", () => {
  const dir = mkdtempSync(join(tmpdir(), "psych-start-"));
  const globalFile = join(dir, "config.json");
  try {
    const state = makeState();
    state.globalFile = globalFile;
    state.config.model = "p/m";
    const notes = [];
    applyStartupOverrides({ getFlag: () => undefined }, state, ctxOf(notes));
    assert.doesNotMatch(notes[0].message, /\/psych model/, "no setup step is suggested when none is needed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without UI the welcome still marks, so it never nags a headless run", () => {
  const dir = mkdtempSync(join(tmpdir(), "psych-start-"));
  const globalFile = join(dir, "config.json");
  try {
    const state = makeState();
    state.globalFile = globalFile;
    applyStartupOverrides({ getFlag: () => undefined }, state, { hasUI: false, ui: undefined });
    assert.equal(isOnboarded(globalFile), true, "marked even when nothing could be said");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the runtime flag override keeps working through the startup module", () => {
  const state = makeState();
  const notes = [];
  applyStartupOverrides({ getFlag: () => "agent" }, state, ctxOf(notes));
  assert.equal(state.runtimeOverride, "agent");
  applyStartupOverrides({ getFlag: () => "bogus" }, state, ctxOf(notes));
  assert.match(notes.at(-1).message, /api or agent/, "an invalid value is a warning, not silence");
});

test("an unwritable marker is not an error and is retryable", () => {
  const dir = mkdtempSync(join(tmpdir(), "psych-start-"));
  try {
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x");
    const globalFile = join(blocker, "config.json");
    markOnboarded(globalFile);
    assert.equal(isOnboarded(globalFile), false, "unmarked, but no throw");
    // And the config file under it is still readable as defaults — nothing corrupted.
    assert.throws(() => readFileSync(globalFile, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
