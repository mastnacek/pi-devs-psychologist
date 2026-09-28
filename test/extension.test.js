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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCtx, makePi } from "./fakes.js";
import devsPsychologistExtension from "../index.js";

/** Events the extension is expected to subscribe to. */
const EXPECTED_EVENTS = [
  "session_start",
  "input",
  "tool_execution_start",
  "tool_execution_end",
  "turn_end",
  "session_shutdown",
];

function load(env = {}) {
  const pi = makePi();
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
  devsPsychologistExtension(pi);
  return { pi, restore };
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

    // session_start plus the four observer subscriptions: the shutdown handler
    // itself is not tracked, because it is the drainer.
    assert.deepEqual(
      [...pi.unsubscribed].sort(),
      ["input", "session_start", "tool_execution_end", "tool_execution_start", "turn_end"],
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

