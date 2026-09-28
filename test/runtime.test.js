/**
 * The runtime switch's visible surface — chip, report and the `--psych-runtime` flag (T21).
 *
 * The flag is the one part that reaches out of the config: it must override the runtime for a single
 * process and must NOT be written to disk, because consent for a wider data boundary must never ride
 * in on a one-run flag. The chip must say when `runtime: "agent"` has no model — "observation only"
 * and "configured" otherwise look identical.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { stringsFor } from "../src/shared/i18n.js";
import { paintChip, STATUS_ID } from "../src/shared/status.js";
import { renderReport } from "../src/slices/report/index.js";
import devsPsychologistExtension from "../index.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

function stateWith(over = {}, agentOver = {}) {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, ...over, agent: { ...DEFAULT_CONFIG.agent, ...agentOver } };
  return state;
}

function chip(state, ctx = makeCtx()) {
  paintChip(state, ctx);
  return ctx.statusCalls.at(-1);
}

test("agent runtime without a model says so, in both locales", () => {
  assert.deepEqual(chip(stateWith({ runtime: "agent", model: "" })), {
    id: STATUS_ID,
    text: stringsFor("en").chipAgentNoModel,
  });
  assert.deepEqual(chip(stateWith({ runtime: "agent", model: "", lang: "cs" })), {
    id: STATUS_ID,
    text: stringsFor("cs").chipAgentNoModel,
  });
});

test("agent runtime with a model (agent.model or the shared model) shows the appraisal chip", () => {
  const viaAgent = chip(stateWith({ runtime: "agent" }, { model: "openrouter-soukr/x/y" }));
  assert.equal(viaAgent.text, "psych 0t · 0/12");
  const viaShared = chip(stateWith({ runtime: "agent", model: "shared/m" }));
  assert.equal(viaShared.text, "psych 0t · 0/12");
});

test("api runtime with no model keeps the signals chip, unchanged", () => {
  assert.equal(chip(stateWith({ runtime: "api", model: "" })).text, "psych: signals");
});

test("the report shows the runtime, the effective agent model and the context level", () => {
  const text = renderReport({
    state: stateWith({ runtime: "agent" }, { model: "openrouter-soukr/x/y", context: "digest" }),
    signals: [],
    history: [],
    lang: "en",
  });
  assert.match(text, /runtime\s+agent/);
  assert.match(text, /context\s+digest/);
  assert.match(text, /agent\s+openrouter-soukr\/x\/y/);
});

test("api runtime still reports, and does not show an agent-only row", () => {
  const text = renderReport({
    state: stateWith({ runtime: "api", model: "a/b" }),
    signals: [],
    history: [],
    lang: "en",
  });
  assert.match(text, /runtime\s+api/);
  assert.match(text, /context\s+evidence/);
  assert.doesNotMatch(text, /agent\s+a\/b/);
});

/** One temp config home for the whole suite, removed at exit. */
const HOME = mkdtempSync(join(tmpdir(), "psych-rt-home-"));
process.on("exit", () => rmSync(HOME, { recursive: true, force: true }));
let loadCount = 0;
function load() {
  const pi = makePi();
  loadCount += 1;
  const globalFile = join(HOME, `pi-devs-psychologist-${loadCount}.json`);
  devsPsychologistExtension(pi, { globalFile });
  return { pi, globalFile };
}

function world() {
  const cwd = mkdtempSync(join(tmpdir(), "psych-rt-"));
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("--psych-runtime overrides the runtime for the process and is never written to disk", async () => {
  const { pi, globalFile } = load();
  const dir = world();
  try {
    // Mirrors `--psych-runtime agent`: the flag value the engine would hand back at session start.
    pi.flags.set("psych-runtime", "agent");
    const ctx = makeCtx({ cwd: dir.cwd });
    await pi.emit("session_start", { type: "session_start" }, ctx);

    // The override took effect (no model, agent runtime => the observation-only chip).
    assert.equal(ctx.statusCalls.at(-1).text, stringsFor("en").chipAgentNoModel);
    // And nothing was persisted: the seeded file is still the untouched defaults.
    assert.deepEqual(JSON.parse(readFileSync(globalFile, "utf8")), DEFAULT_CONFIG);
  } finally {
    dir.cleanup();
  }
});

test("an invalid --psych-runtime value is ignored with a notification, and changes nothing", async () => {
  const { pi, globalFile } = load();
  const dir = world();
  try {
    pi.flags.set("psych-runtime", "child");
    const ctx = makeCtx({ cwd: dir.cwd });
    await pi.emit("session_start", { type: "session_start" }, ctx);

    assert.equal(ctx.statusCalls.at(-1).text, stringsFor("en").chipSignals, "runtime stays api");
    const warning = ctx.notes.find((n) => n.level === "warning");
    assert.ok(warning, "the invalid value was named, not swallowed");
    assert.equal(warning.message, stringsFor("en").runtimeFlagInvalid("child"));
    assert.deepEqual(JSON.parse(readFileSync(globalFile, "utf8")), DEFAULT_CONFIG);
  } finally {
    dir.cleanup();
  }
});

test("the --psych-runtime override survives an unrelated setting command, and yields to /psych runtime", async () => {
  const { pi } = load();
  const dir = world();
  try {
    pi.flags.set("psych-runtime", "agent");
    const ctx = makeCtx({ cwd: dir.cwd });
    await pi.emit("session_start", { type: "session_start" }, ctx);
    const psych = pi.commands.get("psych");

    // `/psych lang cs` saves and reloads the config; the one-run flag must not be lost by it.
    await psych.handler("lang cs", ctx);
    assert.equal(ctx.statusCalls.at(-1).text, stringsFor("cs").chipAgentNoModel, "still agent runtime after a reload");

    // An explicit runtime choice is the operator's latest word and supersedes the flag.
    await psych.handler("runtime api", ctx);
    assert.equal(ctx.statusCalls.at(-1).text, stringsFor("cs").chipSignals, "the explicit choice wins");
  } finally {
    dir.cleanup();
  }
});
