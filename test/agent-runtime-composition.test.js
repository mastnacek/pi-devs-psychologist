/**
 * The composition root's runtime switch (T24).
 *
 * `index.ts` is the only place that decides which runtime runs an appraisal, and it is the one file
 * no other test imports directly. So this loads the real extension and drives it through a real
 * `turn_end`, with a FAKE process surface (`agentIo`) — never a real child pi — and asserts which
 * call was made. The session cost cap lives in that same wiring, so it is asserted here too.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import devsPsychologistExtension from "../index.js";
import { makeCtx, makePi } from "./fakes.js";

const WINDOW_LINE = "window: 0 prompt(s), 0 tool call(s), 0 min";

/** An appraisal the enforcement layer keeps, citing the only live line an empty window produces. */
function validResponse() {
  return JSON.stringify({
    needs: {
      autonomy: { state: "at_risk", cited: [WINDOW_LINE] },
      competence: { state: "unmet", cited: [WINDOW_LINE] },
      relatedness: { state: "met", cited: [WINDOW_LINE] },
    },
    load: { level: "high", cited: [WINDOW_LINE] },
    progress: { state: "blocked", cited: [WINDOW_LINE] },
    flow: { state: "broken", cited: [WINDOW_LINE] },
    interventions: [{ kind: "name_next_win", text: "Name the smallest increment.", cited: [WINDOW_LINE] }],
  });
}

/** A scripted fake child: emits a psych_submit (with a cost) then closes, on the next macrotask. */
function scriptedChild({ cost = 0.5, exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.pid = 9999;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => {
    child.stdout.emit("data", Buffer.from(JSON.stringify({ type: "tool_execution_start", toolCallId: "c1", toolName: "psych_submit", args: JSON.parse(validResponse()) }) + "\n"));
    child.stdout.emit("data", Buffer.from(JSON.stringify({ type: "tool_execution_end", toolCallId: "c1", toolName: "psych_submit", isError: false }) + "\n"));
    child.stdout.emit("data", Buffer.from(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ok" }], usage: { input: 1, output: 1, cost: { total: cost } } } }) + "\n"));
    child.emit("close", exitCode);
  });
  return child;
}

function fakeIo(children) {
  const queue = [...children];
  const record = { spawn: [] };
  return {
    record,
    io: {
      spawn: (command, args) => {
        record.spawn.push({ command, args });
        const child = queue.shift();
        if (!child) throw new Error("no child queued");
        return child;
      },
      mkdir: () => {},
      writeFile: () => {},
      rm: () => {},
      killTree: () => {},
      now: () => Date.now(),
      setTimeout: () => 1,
      clearTimeout: () => {},
    },
  };
}

const CONFIG_HOME = mkdtempSync(join(tmpdir(), "psych-agent-home-"));
process.on("exit", () => rmSync(CONFIG_HOME, { recursive: true, force: true }));
let loadCount = 0;

function load(agentIo) {
  const pi = makePi();
  loadCount += 1;
  const globalFile = join(CONFIG_HOME, `pi-devs-psychologist-${loadCount}.json`);
  devsPsychologistExtension(pi, { globalFile, ...(agentIo ? { agentIo } : {}) });
  return { pi, globalFile };
}

function writeConfig(globalFile, over = {}, agentOver = {}) {
  writeFileSync(
    globalFile,
    JSON.stringify({
      ...DEFAULT_CONFIG,
      model: "p/m",
      maxAppraisalsPerSession: 5,
      ...over,
      agent: { ...DEFAULT_CONFIG.agent, timeoutMs: 60_000, maxCostUsd: 0.25, maxCostUsdPerSession: 0, ...agentOver },
    }),
    "utf8",
  );
}

function sandbox() {
  const cwd = mkdtempSync(join(tmpdir(), "psych-agent-cwd-"));
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

function ctxFor(cwd, over = {}) {
  return makeCtx({
    cwd,
    isProjectTrusted: () => true,
		sessionManager: {
			getEntries: () => [],
			getBranch: () => [],
			getSessionFile: () => join(cwd, "parent.jsonl"),
		},
    ...over,
  });
}

test("runtime 'agent' spawns the child runner; the API call is not used", async () => {
  const { io, record } = fakeIo([scriptedChild()]);
  const { pi, globalFile } = load(io);
  const world = sandbox();
  try {
    writeConfig(globalFile, { runtime: "agent" });
    const ctx = ctxFor(world.cwd);
    await pi.emit("session_start", { type: "session_start" }, ctx);
    await pi.commands.get("psych").handler("now", ctx);

    assert.equal(record.spawn.length, 1, "the agent runtime ran exactly once");
    assert.equal(record.spawn[0].command, process.execPath, "node runs the engine, never a shell");
    assert.ok(record.spawn[0].args.includes("--mode"));
		assert.ok(
			record.spawn[0].args.some((arg) => arg.startsWith("@")),
			"the message is the @file token",
		);
  } finally {
    world.cleanup();
  }
});

test("runtime 'api' uses the API call and never spawns a child", async () => {
  const { io, record } = fakeIo([scriptedChild()]);
  const { pi, globalFile } = load(io);
  const world = sandbox();
  try {
    writeConfig(globalFile, { runtime: "api" });
    const model = { provider: "p", id: "m" };
    const registry = {
      find: (p, id) => (p === "p" && id === "m" ? model : undefined),
      getAll: () => [model],
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {}, env: {} }),
      complete: async () => ({
        stopReason: "stop",
        content: [{ type: "text", text: validResponse() }],
        usage: { input: 10, output: 5, totalTokens: 15, cost: { total: 0.002 } },
      }),
    };
    const ctx = ctxFor(world.cwd, { modelRegistry: registry });
    await pi.emit("session_start", { type: "session_start" }, ctx);
    await pi.commands.get("psych").handler("now", ctx);

    assert.equal(record.spawn.length, 0, "the agent runner was not reached");
  } finally {
    world.cleanup();
  }
});

test("the session cost cap refuses a further run once it is reached (stage 'budget')", async () => {
  const { io, record } = fakeIo([scriptedChild({ cost: 0.5 })]);
  const { pi, globalFile } = load(io);
  const world = sandbox();
  try {
    // A per-run cap of 0 (unlimited) but a session cap of 0.25 the first run exceeds.
    writeConfig(globalFile, { runtime: "agent" }, { maxCostUsd: 0, maxCostUsdPerSession: 0.25 });
    const ctx = ctxFor(world.cwd);
    await pi.emit("session_start", { type: "session_start" }, ctx);
    await pi.commands.get("psych").handler("now", ctx);
    assert.equal(record.spawn.length, 1);
    assert.equal(ctx.modelRegistry, undefined);

    // The second turn reaches the cap; the run is refused before any child is spawned.
    await pi.commands.get("psych").handler("now", ctx);
    assert.equal(record.spawn.length, 1, "no second child was spawned");
  } finally {
    world.cleanup();
  }
});

test("session_shutdown kills a running child (idempotent)", async () => {
  const child = new EventEmitter();
  child.pid = 7777;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // This child never closes on its own: it is still "running" when shutdown arrives.
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
  const { pi, globalFile } = load(io);
  const world = sandbox();
  try {
    writeConfig(globalFile, { runtime: "agent" });
    const ctx = ctxFor(world.cwd);
    await pi.emit("session_start", { type: "session_start" }, ctx);
    // Fire and forget: the turn_end handler is still awaiting the child when shutdown lands.
    const pending = pi.commands.get("psych").handler("now", ctx);
    await new Promise((resolve) => setImmediate(resolve));
    await pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);

    assert.deepEqual(killed, [7777], "the running child tree was killed");
    // Let the pending turn finish so nothing leaks into the next test file.
    child.emit("close", null);
    await pending;
  } finally {
    world.cleanup();
  }
});
