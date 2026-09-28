/**
 * Async delivery and the researching UX (T26).
 *
 * The headline invariants: `turn_end` never awaits the appraisal (a session must not block on a
 * model that takes tens of seconds), a result that lands mid-stream is HELD until the agent pauses,
 * a newer held result replaces an older one, and `/psych stop` kills the run and records `aborted`.
 * The chip and its timer are asserted with an injected clock, so no test owns a real interval.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  maybeAppraise,
  registerAppraiser,
  flushPendingAppraisal,
  stopAppraisal,
} from "../src/slices/appraiser/index.js";
import { STALE_DELIVERY_TURNS } from "../src/shared/delivery.js";
import { completePsych, registerPsychCommand } from "../src/slices/commands/index.js";
import { FRAME_LINES, layoutCard, measureCard } from "../src/slices/overlay/layout.js";
import { neutralAppraisal } from "../src/shared/appraisal.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { stringsFor } from "../src/shared/i18n.js";
import { paintChip, startResearchingChip, stopResearchingChip, STATUS_ID } from "../src/shared/status.js";
import devsPsychologistExtension from "../index.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

const WINDOW_LINE = "window: 0 prompt(s), 0 tool call(s), 0 min";
const PLAIN = { fg: (_c, t) => t, bold: (t) => t, bg: (_c, t) => t };

function configWith(over = {}) {
  return { ...DEFAULT_CONFIG, model: "p/m", trigger: "cadence", cadenceTurns: 1, ...over };
}

function validResponse(text = "Name the smallest increment.") {
  return JSON.stringify({
    needs: {
      autonomy: { state: "at_risk", cited: [WINDOW_LINE] },
      competence: { state: "unmet", cited: [WINDOW_LINE] },
      relatedness: { state: "met", cited: [WINDOW_LINE] },
    },
    load: { level: "high", cited: [WINDOW_LINE] },
    progress: { state: "blocked", cited: [WINDOW_LINE] },
    flow: { state: "broken", cited: [WINDOW_LINE] },
    interventions: [{ kind: "name_next_win", text, cited: [WINDOW_LINE] }],
  });
}

function makeDeps(over = {}) {
  const deliveries = [];
  const deliveryOptions = [];
  return {
    deliveries,
    deliveryOptions,
    readHistory: () => ({ evidence: [] }),
    callModel: async () => ({
      ok: true,
      text: validResponse(),
      provider: "p",
      modelId: "m",
      label: "p/m",
      usage: undefined,
    }),
    deliver: async (_api, _state, _ctx, appraisal, options) => {
      deliveries.push(appraisal);
      deliveryOptions.push(options);
      return { human: "card", agent: false };
    },
    ...over,
  };
}

test("turn_end starts the appraisal and returns before a slow model resolves", async () => {
  const pi = makePi();
  const state = makeState();
  state.config = configWith();
  state.turnsSinceAppraisal = 1;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started = 0;
  const deps = makeDeps({
    callModel: async () => {
      started += 1;
      await gate;
      return { ok: true, text: validResponse(), provider: "p", modelId: "m", label: "p/m", usage: undefined };
    },
  });
  registerAppraiser(pi, state, deps);

  const race = await Promise.race([
    pi
      .emit("turn_end", { type: "turn_end", turnIndex: 0, message: {}, toolResults: [] }, makeCtx())
      .then(() => "resolved"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 1000)),
  ]);
  assert.equal(race, "resolved", "the handler must not await the appraisal");
  assert.equal(started, 1, "the call was started");
  const pending = state.appraisalPromise;
  release();
  await pending;
});

test("a result that lands mid-stream is delivered only after the simulated agent_end", async () => {
  const pi = makePi();
  const state = makeState();
  state.config = configWith();
  state.turnsSinceAppraisal = 5;
  const deps = makeDeps();
  registerAppraiser(pi, state, deps);
  const ctx = makeCtx();

  await pi.emit("agent_start", { type: "agent_start" }, ctx);
  await pi.emit("turn_end", { type: "turn_end", turnIndex: 0, message: {}, toolResults: [] }, ctx);
  await state.appraisalPromise;

  assert.equal(deps.deliveries.length, 0, "held, not delivered mid-stream");
  assert.ok(state.pendingAppraisal, "stored as pending");
  await pi.emit("agent_end", { type: "agent_end" }, ctx);
  assert.equal(deps.deliveries.length, 1, "delivered at the pause");
  assert.equal(state.pendingAppraisal, undefined, "and the slot is cleared");
});

test("a newer held result replaces the older one: newest wins", async () => {
  const pi = makePi();
  const state = makeState();
  state.config = configWith();
  state.turnsSinceAppraisal = 5;
  state.agentStreaming = true;
  let n = 0;
  const deps = makeDeps({
    callModel: async () => ({
      ok: true,
      text: validResponse(`Increment ${n++}`),
      provider: "p",
      modelId: "m",
      label: "p/m",
      usage: undefined,
    }),
  });

  await maybeAppraise(pi, state, makeCtx(), deps);
  state.turnsSinceAppraisal = 5;
  await maybeAppraise(pi, state, makeCtx(), deps);
  assert.equal(state.pendingAppraisal.appraisal.interventions[0].text, "Increment 1");

  state.agentStreaming = false;
  await flushPendingAppraisal(pi, state, makeCtx(), deps);
  assert.equal(deps.deliveries.length, 1, "one delivery, not two");
  assert.equal(deps.deliveries[0].interventions[0].text, "Increment 1");
});

test("staleness is measured from the run's start and passed to delivery", async () => {
  const pi = makePi();
  const state = makeState();
  state.config = configWith();
  state.turnsSinceAppraisal = 5;
  state.turnCount = 0;
  const deps = makeDeps();
  const running = maybeAppraise(pi, state, makeCtx(), deps);
  // The session moves on while the model is thinking.
  state.turnCount = 5;
  await running;
  assert.equal(deps.deliveryOptions.at(-1).staleTurns, 5);
});

test("a stale card names how old it is, and measureCard stays exact", () => {
  const appraisal = neutralAppraisal();
  appraisal.progress = { state: "blocked", cited: [WINDOW_LINE] };
  const s = stringsFor("en");
  const stale = { appraisal, unmatched: [], staleTurns: 4 };
  const fresh = { appraisal, unmatched: [], staleTurns: 1 };

  const { head, tail } = layoutCard(stale, s, 76, PLAIN);
  assert.match(head[0].text, /4 turns ago/, "the header states the age");
  const measured = measureCard(stale, s, 76);
  assert.equal(measured.head, head.length);
  assert.equal(measured.tail, tail.length);
  assert.equal(measured.total, FRAME_LINES + head.length + tail.length);
  // Below the threshold, no header line is added.
  assert.equal(measureCard(fresh, s, 76).head, measured.head - 1);
  assert.ok(STALE_DELIVERY_TURNS === 3);
});

test("the researching chip shows elapsed time and, on the agent runtime, the tool count", () => {
  const state = makeState();
  state.config = configWith({ runtime: "agent" });
  state.timers = { now: () => 43_000, setInterval: () => 1, clearInterval: () => {} };
  state.appraisalStartedAt = 1_000;
  state.appraisalToolCalls = 7;
  const ctx = makeCtx();

  paintChip(state, ctx);
  assert.deepEqual(ctx.statusCalls.at(-1), { id: STATUS_ID, text: "psych: researching 42s · 7 tools" });

  state.config.runtime = "api";
  paintChip(state, ctx);
  assert.deepEqual(ctx.statusCalls.at(-1), { id: STATUS_ID, text: "psych: researching 42s" });
});

test("the researching timer starts once and clears on stop", () => {
  const state = makeState();
  let ticks = 0;
  let cleared = 0;
  state.timers = { now: () => 0, setInterval: () => { ticks += 1; return "h"; }, clearInterval: () => { cleared += 1; } };

  startResearchingChip(state, makeCtx());
  assert.equal(state.chipTimer, "h");
  startResearchingChip(state, makeCtx());
  assert.equal(ticks, 1, "starting twice does not leak a second interval");

  stopResearchingChip(state);
  assert.equal(cleared, 1);
  assert.equal(state.chipTimer, undefined);
  assert.equal(state.appraisalStartedAt, undefined);
});

test("the researching timer is cleared when the appraisal completes", async () => {
  const pi = makePi();
  const state = makeState();
  state.config = configWith();
  state.turnsSinceAppraisal = 1;
  let cleared = 0;
  state.timers = { now: () => 0, setInterval: () => "h", clearInterval: () => { cleared += 1; } };

  await maybeAppraise(pi, state, makeCtx(), makeDeps());
  assert.equal(cleared, 1);
  assert.equal(state.chipTimer, undefined);
});

test("stopAppraisal kills the run, records aborted and clears pending", () => {
  const state = makeState();
  let killed = 0;
  state.appraisalInFlight = true;
  state.agentChildKill = () => { killed += 1; };
  state.pendingAppraisal = { appraisal: neutralAppraisal(), evenIfSilent: false, startedTurn: 0 };

  const ran = stopAppraisal(state, "stopped by the operator");
  assert.equal(ran, true);
  assert.equal(killed, 1);
  assert.equal(state.agentChildKill, undefined);
  assert.equal(state.pendingAppraisal, undefined);
  assert.deepEqual(state.lastAppraisalFailure, { stage: "aborted", error: "stopped by the operator" });

  assert.equal(stopAppraisal(makeState(), "x"), false, "nothing running means nothing to stop");
});

test("aborting the in-flight appraisal yields stage 'aborted'", async () => {
  const pi = makePi();
  const state = makeState();
  state.config = configWith();
  state.turnsSinceAppraisal = 1;
  const deps = makeDeps({
    callModel: (_registry, req) =>
      new Promise((resolve) => {
        req.signal.addEventListener(
          "abort",
          () => resolve({ ok: false, stage: "aborted", error: "the appraisal was aborted" }),
          { once: true },
        );
      }),
  });
  const running = maybeAppraise(pi, state, makeCtx(), deps);
  await new Promise((resolve) => setImmediate(resolve));
  state.appraisalAbort.abort();
  const outcome = await running;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.stage, "aborted");
  assert.equal(state.lastAppraisalFailure.stage, "aborted");
});

test("`stop` is offered as a terminal leaf in the completion menu", () => {
  const items = completePsych(makeState(), "stop");
  assert.equal(items[0].value, "stop", "no trailing space: Tab confirms it as final");
});

test("the command notifies when there is nothing to stop", async () => {
  const pi = makePi();
  const state = makeState();
  const ctx = makeCtx();
  registerPsychCommand(pi, state, {
    now: async () => "done",
    stop: () => stringsFor("en").stopNothing,
    report: () => {},
    effect: () => {},
    save: () => "",
    reload: () => {},
  });
  await pi.commands.get("psych").handler("stop", ctx);
  assert.equal(ctx.notes.at(-1).message, stringsFor("en").stopNothing);
});

/* --- composition-root integration: the real wiring --- */

const HOME = mkdtempSync(join(tmpdir(), "psych-async-home-"));
process.on("exit", () => rmSync(HOME, { recursive: true, force: true }));
let loadCount = 0;

function load(options = {}) {
  const pi = makePi();
  loadCount += 1;
  const globalFile = join(HOME, `pi-devs-psychologist-${loadCount}.json`);
  devsPsychologistExtension(pi, { globalFile, ...options });
  return { pi, globalFile };
}

function writeConfig(globalFile, over = {}) {
  writeFileSync(
    globalFile,
    JSON.stringify({ ...DEFAULT_CONFIG, model: "p/m", maxAppraisalsPerSession: 5, ...over }),
    "utf8",
  );
}

function ctxFor(cwd, over = {}) {
  return makeCtx({
    cwd,
    isProjectTrusted: () => true,
    sessionManager: { getEntries: () => [], getBranch: () => [], getSessionFile: () => join(cwd, "parent.jsonl") },
    ...over,
  });
}

test("session_shutdown clears the researching timer", async () => {
  let cleared = 0;
  const timers = { now: () => 0, setInterval: () => "h", clearInterval: () => { cleared += 1; } };
  const { pi, globalFile } = load({ timerIo: timers });
  const cwd = mkdtempSync(join(tmpdir(), "psych-async-cwd-"));
  try {
    writeConfig(globalFile, { runtime: "api", trigger: "cadence", cadenceTurns: 1 });
    const model = { provider: "p", id: "m" };
    const registry = {
      find: (provider, id) => (provider === "p" && id === "m" ? model : undefined),
      getAll: () => [model],
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {}, env: {} }),
      // Never resolves: the run is still in flight when shutdown arrives.
      complete: () => new Promise(() => {}),
    };
    const ctx = ctxFor(cwd, { modelRegistry: registry });
    await pi.emit("session_start", { type: "session_start" }, ctx);
    await pi.emit("turn_end", { type: "turn_end", turnIndex: 0, message: {}, toolResults: [] }, ctx);
    assert.equal(cleared, 0, "a timer is running");

    await pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);
    assert.equal(cleared, 1, "shutdown cleared the researching timer");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("/psych stop kills the running child and the report says 'aborted'", async () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const killed = [];
  const io = {
    spawn: () => child,
    mkdir: () => {},
    writeFile: () => {},
    rm: () => {},
    killTree: (pid) => killed.push(pid),
    now: () => Date.now(),
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  const { pi, globalFile } = load({ agentIo: io });
  const cwd = mkdtempSync(join(tmpdir(), "psych-async-stop-"));
  try {
    writeConfig(globalFile, { runtime: "agent" });
    const ctx = ctxFor(cwd);
    await pi.emit("session_start", { type: "session_start" }, ctx);
    // Fire-and-forget: the child never closes on its own, so the run stays in flight.
    const running = pi.commands.get("psych").handler("now", ctx);
    await new Promise((resolve) => setImmediate(resolve));
    await pi.commands.get("psych").handler("stop", ctx);
    assert.deepEqual(killed, [4242], "the child tree was killed");
    assert.equal(ctx.notes.at(-1).message, stringsFor("en").stopRequested);

    // The report names the stage, so the failure is diagnosable.
    await pi.commands.get("psych").handler("status", ctx);
    assert.match(ctx.notes.at(-1).message, /aborted/);

    child.emit("close", null);
    await running;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});