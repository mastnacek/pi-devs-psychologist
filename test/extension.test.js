/**
 * Composition root — the extension actually loads, wires what it claims to wire,
 * and drains cleanly.
 *
 * `index.ts` is the only file no other test imports, and it is the one whose
 * failure mode is invisible: a missing `track()` leaks a listener into every later
 * session, a missing recursion guard makes the plugin observe its own subagents,
 * and neither shows up until someone wonders why the numbers are wrong. So it is
 * loaded here for real, through the same default export Pi calls.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringsFor } from "../src/shared/i18n.js";
import { makeCtx, makePi } from "./fakes.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import devsPsychologistExtension from "../index.js";

/** Events the extension is expected to subscribe to. */
const EXPECTED_EVENTS = [
  "session_start",
  "input",
  "tool_execution_start",
  "tool_execution_end",
  "turn_end",
  // The appraiser holds a finished result until the agent pauses (T26).
  "agent_start",
  "agent_end",
  "session_shutdown",
];


/**
 * One temp config home for the whole suite, removed at exit. Pointing the extension at
 * it is what keeps these tests from creating the operator's real
 * ~/.pi/agent/pi-devs-psychologist.json — the extension seeds that file on the first
 * session, so a test without this would write into the developer's home.
 */
const CONFIG_HOME = mkdtempSync(join(tmpdir(), "psych-ext-home-"));
process.on("exit", () => rmSync(CONFIG_HOME, { recursive: true, force: true }));
let loadCount = 0;
function load(env = {}) {
  const pi = makePi();
  loadCount += 1;
  const globalFile = join(CONFIG_HOME, `pi-devs-psychologist-${loadCount}.json`);
  const saved = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  devsPsychologistExtension(pi, { globalFile });
  return { pi, globalFile, restore };
}

function sandbox() {
  const cwd = mkdtempSync(join(tmpdir(), "psych-ext-"));
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("loading the extension subscribes to the events it uses", () => {
  const { pi, restore } = load();
  try {
    assert.deepEqual([...pi.handlers.keys()].sort(), [...EXPECTED_EVENTS].sort());
  } finally {
    restore();
  }
});

test("every subscription is tracked, and session_shutdown drains the tracked ones", async () => {
  const { pi, restore } = load();
  const world = sandbox();
  try {
    const ctx = makeCtx({ cwd: world.cwd });
    await pi.emit("session_start", { type: "session_start" }, ctx);

    await pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);

    // session_start, the observer's four, the appraiser's three (turn_end, agent_start,
    // agent_end), the handoff's two (session_start, session_shutdown) and the history writer's one
    // (session_shutdown). The shutdown handler itself is not tracked, because it is the drainer in
    // the composition root.
    assert.deepEqual(
      [...pi.unsubscribed].sort(),
      [
        "agent_end",
        "agent_start",
        "input",
        "session_shutdown",
        "session_shutdown",
        "session_start",
        "session_start",
        "tool_execution_end",
        "tool_execution_start",
        // turn_end twice: the observer records the turn, the appraiser reacts to it.
        "turn_end",
        "turn_end",
      ],
    );
    // Draining twice must not throw: cancellation, reload and exit all converge here.
    await pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);
  } finally {
    world.cleanup();
    restore();
  }
});

test("a session paints the chip once config is loaded, and shutdown clears it", async () => {
  const { pi, restore } = load();
  const world = sandbox();
  try {
    const ctx = makeCtx({ cwd: world.cwd });
    await pi.emit("session_start", { type: "session_start" }, ctx);
    // No model configured by default, so the chip must say so rather than be silent:
    // "observing" and "unconfigured" would otherwise look identical.
    assert.deepEqual(ctx.statusCalls.at(-1), { id: "devs-psychologist", text: "psych: signals" });

    await pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);
    assert.deepEqual(ctx.statusCalls.at(-1), { id: "devs-psychologist", text: undefined });
  } finally {
    world.cleanup();
    restore();
  }
});

test("no UI means no status call and no crash", async () => {
  const { pi, restore } = load();
  const world = sandbox();
  try {
    const ctx = makeCtx({ cwd: world.cwd, hasUI: false, mode: "json" });
    await pi.emit("session_start", { type: "session_start" }, ctx);
    await pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);
    assert.deepEqual(ctx.statusCalls, []);
  } finally {
    world.cleanup();
    restore();
  }
});

test("recursion guard: the plugin stays inert inside a subagent or child session", () => {
  for (const env of [{ PI_SUBAGENT: "true" }, { PI_CHILD_SESSION: "1" }]) {
    const { pi, restore } = load(env);
    try {
      assert.equal(pi.handlers.size, 0, `${Object.keys(env)[0]} must register nothing`);
    } finally {
      restore();
    }
  }
});

test("after shutdown the plugin is inert: a late event is not a crash", async () => {
  // The drain removes listeners but the engine may still deliver an in-flight
  // event. That must be a no-op, not an exception thrown into the session.
  const { pi, restore } = load();
  const world = sandbox();
  try {
    const ctx = makeCtx({ cwd: world.cwd });
    await pi.emit("session_start", { type: "session_start" }, ctx);
    const painted = ctx.statusCalls.length;

    await pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);
    await pi.emit("turn_end", { type: "turn_end", turnIndex: 0, message: {}, toolResults: [] }, ctx);
    await pi.emit("input", { type: "input", text: "late", source: "interactive" }, ctx);

    // Only the shutdown clear was added; nothing after it painted or observed.
    assert.equal(ctx.statusCalls.length, painted + 1);
  } finally {
    world.cleanup();
    restore();
  }
});

test("the config file is created on the first session, with the defaults", async () => {
  // An installed plugin whose config exists nowhere on disk has no answer to "where do
  // I configure this?". Nothing used to create it — saveConfig was only ever called
  // from tests — so the settings were readable, documented and undiscoverable.
  const { pi, globalFile, restore } = load();
  const world = sandbox();
  try {
    assert.equal(existsSync(globalFile), false, "nothing exists before the first session");
    const ctx = makeCtx({ cwd: world.cwd });
    await pi.emit("session_start", { type: "session_start" }, ctx);

    assert.equal(existsSync(globalFile), true);
    assert.deepEqual(JSON.parse(readFileSync(globalFile, "utf8")), DEFAULT_CONFIG);
    // Silent seeding would leave the file exactly as undiscoverable as no file.
    assert.match(ctx.notes.at(-1).message, /config created at/);
  } finally {
    world.cleanup();
    restore();
  }
});

test("an existing config file is never overwritten, not even a broken one", async () => {
  const { pi, globalFile, restore } = load();
  const world = sandbox();
  try {
    const handWritten = '{ "model": "openrouter-soukr/chosen/model", "lang": "cs" }';
    writeFileSync(globalFile, handWritten, "utf8");

    const ctx = makeCtx({ cwd: world.cwd });
    await pi.emit("session_start", { type: "session_start" }, ctx);

    assert.equal(readFileSync(globalFile, "utf8"), handWritten, "the operator's file wins");
    // The welcome is the one thing that IS announced here (once per machine, independent of the
    // seed): an install whose defaults do not say "start here" leaves the operator guessing.
    assert.equal(ctx.notes.filter((n) => /psych help/.test(n.message)).length, 1, "the welcome, not the seed, is announced");

    // And a file that cannot be parsed is still left alone: corrupt input must not
    // be silently replaced with defaults, because that would destroy a real edit.
    writeFileSync(globalFile, "{ not json", "utf8");
    await pi.emit("session_start", { type: "session_start" }, ctx);
    assert.equal(readFileSync(globalFile, "utf8"), "{ not json");
    assert.equal(ctx.notes.filter((n) => /psych help/.test(n.message)).length, 1, "the welcome shows once, not every start");
  } finally {
    world.cleanup();
    restore();
  }
});

test("seeding is announced once, not on every session", async () => {
  const { pi, globalFile, restore } = load();
  const world = sandbox();
  try {
    const ctx = makeCtx({ cwd: world.cwd });
    await pi.emit("session_start", { type: "session_start" }, ctx);
    await pi.emit("session_start", { type: "session_start" }, ctx);
    await pi.emit("session_start", { type: "session_start" }, ctx);
    assert.equal(ctx.notes.filter((n) => /config created/.test(n.message)).length, 1);
    assert.equal(existsSync(globalFile), true);
  } finally {
    world.cleanup();
    restore();
  }
});

test("an unwritable config path is not an error", async () => {
  // A read-only or nonsense path must degrade to defaults, not break the session.
  const { pi, restore } = load();
  const world = sandbox();
  try {
    const blocker = join(world.cwd, "blocker");
    writeFileSync(blocker, "i am a file, not a directory", "utf8");
    const pi2 = makePi();
    devsPsychologistExtension(pi2, { globalFile: join(blocker, "config.json") });

    const ctx = makeCtx({ cwd: world.cwd });
    await pi2.emit("session_start", { type: "session_start" }, ctx);
    // The unwritable path kills the marker write too, so the welcome still shows (and would
    // repeat); nothing throws. The seed says nothing, because nothing was created.
    assert.equal(ctx.notes.filter((n) => /config created/.test(n.message)).length, 0);
    assert.ok(ctx.notes.every((n) => /psych help/.test(n.message)), "only the welcome is announced");
    // The session still works: the chip painted from the defaults.
    assert.equal(ctx.statusCalls.at(-1).text, "psych: signals");
  } finally {
    world.cleanup();
    restore();
  }
});

test("the seeded file is the file the plugin then reads", async () => {
  // Seeding and reading must agree, or the file would be a decoy.
  const { pi, globalFile, restore } = load();
  const world = sandbox();
  try {
    const ctx = makeCtx({ cwd: world.cwd });
    await pi.emit("session_start", { type: "session_start" }, ctx);
    writeFileSync(globalFile, JSON.stringify({ ...DEFAULT_CONFIG, model: "a/b" }), "utf8");
    await pi.emit("session_start", { type: "session_start" }, ctx);
    assert.equal(ctx.statusCalls.at(-1).text, "psych 0t · 0/12", "the model set in the file took effect");
  } finally {
    world.cleanup();
    restore();
  }
});


test("the --psych-runtime flag description comes from the string table", async () => {
  // The engine prints a flag's description into `pi --help`, so the operator reads it: it is
  // user-facing text and the `multilingual-ui` invariant failed it hardcoded in index.ts. Checked
  // through the real registerFlag, in both locales.
  const { default: extension } = await import("../index.js");
  for (const [lang, file] of [["en", undefined], ["cs", undefined]]) {
    const dir = mkdtempSync(join(tmpdir(), `psych-flag-${lang}-`));
    try {
      const globalFile = join(dir, "pi-devs-psychologist.json");
      writeFileSync(globalFile, JSON.stringify({ lang }));
      const flags = new Map();
      const pi = makePi();
      pi.registerFlag = (name, options) => flags.set(name, options);
      extension(pi, { globalFile });
      const described = flags.get("psych-runtime")?.description;
      assert.equal(typeof described, "string");
      assert.equal(described, stringsFor(lang).flagPsychRuntime);
      // The saved machine-wide language decides it, because a flag is registered before the
      // project layer of the cascade is known.
      assert.notEqual(described, stringsFor(lang === "en" ? "cs" : "en").flagPsychRuntime);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
