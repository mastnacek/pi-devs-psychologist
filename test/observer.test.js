/**
 * Observer — what the engine's events become in the observation window.
 *
 * The rule these tests defend: nothing enters the window that did not happen,
 * and nothing is attributed to the programmer that they did not say.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { makeCtx, makePi, makeState } from "./fakes.js";
import {
  commandFromArgs,
  isProgrammerPrompt,
  pathFromArgs,
  registerObserver,
} from "../src/slices/observer/index.js";

function wired(over = {}) {
  const pi = makePi();
  const state = makeState(over);
  registerObserver(pi, state);
  return { pi, state, ctx: makeCtx() };
}

test("a programmer prompt is recorded with its text", async () => {
  const { pi, state, ctx } = wired();
  await pi.emit("input", { type: "input", text: "fix the width clamp", source: "interactive" }, ctx);
  assert.equal(state.observations.length, 1);
  assert.deepEqual(
    { kind: state.observations[0].kind, text: state.observations[0].text },
    { kind: "prompt", text: "fix the width clamp" },
  );
});

test("an extension-injected prompt is not attributed to the programmer", async () => {
  const { pi, state, ctx } = wired();
  await pi.emit("input", { type: "input", text: "[self-compact handoff]", source: "extension" }, ctx);
  assert.equal(state.observations.length, 0);
  assert.equal(isProgrammerPrompt("extension"), false);
  assert.equal(isProgrammerPrompt("interactive"), true);
  assert.equal(isProgrammerPrompt("rpc"), true);
});

test("a tool call is paired with its outcome, and a failure is recorded as a failure", async () => {
  const { pi, state, ctx } = wired();
  await pi.emit(
    "tool_execution_start",
    { type: "tool_execution_start", toolCallId: "a", toolName: "bash", args: { command: "npm test" } },
    ctx,
  );
  assert.equal(state.pendingTools.size, 1, "in-flight before its end event");

  await pi.emit(
    "tool_execution_end",
    { type: "tool_execution_end", toolCallId: "a", toolName: "bash", result: {}, isError: true },
    ctx,
  );
  assert.equal(state.pendingTools.size, 0, "cleared after its end event");
  assert.deepEqual(state.observations[0], {
    kind: "tool",
    at: state.observations[0].at,
    toolName: "bash",
    command: "npm test",
    path: undefined,
    ok: false,
  });
});

test("an end event without a start is recorded, not dropped", async () => {
  const { pi, state, ctx } = wired();
  await pi.emit(
    "tool_execution_end",
    { type: "tool_execution_end", toolCallId: "orphan", toolName: "edit", result: {}, isError: false },
    ctx,
  );
  assert.equal(state.observations.length, 1, "the call happened even if we missed its start");
  assert.equal(state.observations[0].ok, true);
  assert.equal(state.observations[0].command, undefined);
});

test("parallel tool calls do not share each other's arguments", async () => {
  const { pi, state, ctx } = wired();
  await pi.emit("tool_execution_start", { toolCallId: "1", toolName: "edit", args: { path: "a.ts" } }, ctx);
  await pi.emit("tool_execution_start", { toolCallId: "2", toolName: "edit", args: { path: "b.ts" } }, ctx);
  await pi.emit("tool_execution_end", { toolCallId: "2", toolName: "edit", result: {}, isError: false }, ctx);
  await pi.emit("tool_execution_end", { toolCallId: "1", toolName: "edit", result: {}, isError: false }, ctx);
  assert.deepEqual(
    state.observations.map((item) => item.path),
    ["b.ts", "a.ts"],
    "each end pairs with its own start",
  );
});

test("only mutation tools contribute a path — a read is not churn", async () => {
  const { pi, state, ctx } = wired();
  await pi.emit("tool_execution_start", { toolCallId: "1", toolName: "read", args: { path: "a.ts" } }, ctx);
  await pi.emit("tool_execution_end", { toolCallId: "1", toolName: "read", result: {}, isError: false }, ctx);
  assert.equal(state.observations[0].path, undefined);
  assert.equal(pathFromArgs("read", { path: "a.ts" }), undefined);
  assert.equal(pathFromArgs("edit", { file_path: "a.ts" }), "a.ts");
  assert.equal(pathFromArgs("write", { filePath: "b/c.ts" }), "b/c.ts");
});

test("argument spellings differ per tool and unknown tools record nothing", () => {
  assert.equal(commandFromArgs({ command: "npm test" }), "npm test");
  assert.equal(commandFromArgs({ cmd: "ls" }), "ls");
  assert.equal(commandFromArgs({}), undefined);
  assert.equal(commandFromArgs(null), undefined);
  assert.equal(commandFromArgs("not an object"), undefined);
  assert.equal(pathFromArgs("mystery_tool", { path: "a.ts" }), undefined);
});

test("turn_end advances the appraisal cadence counter", async () => {
  const { pi, state, ctx } = wired();
  assert.equal(state.turnsSinceAppraisal, 0);
  await pi.emit("turn_end", { type: "turn_end", turnIndex: 0, message: {}, toolResults: [] }, ctx);
  await pi.emit("turn_end", { type: "turn_end", turnIndex: 1, message: {}, toolResults: [] }, ctx);
  assert.equal(state.turnsSinceAppraisal, 2);
  assert.equal(state.observations.filter((item) => item.kind === "turn").length, 2);
});

test("a disabled plugin records nothing", async () => {
  const { pi, state, ctx } = wired({ config: { ...makeState().config, enabled: false } });
  await pi.emit("input", { text: "hello", source: "interactive" }, ctx);
  await pi.emit("turn_end", { turnIndex: 0 }, ctx);
  assert.equal(state.observations.length, 0);
});

test("the window is bounded and drops the oldest observations first", () => {
  const state = makeState();
  state.config.retainObservations = 3;
  for (let i = 0; i < 5; i += 1) {
    state.observe({ kind: "prompt", at: i, text: `p${i}` });
  }
  assert.deepEqual(
    state.observations.map((item) => item.text),
    ["p2", "p3", "p4"],
  );
});

test("resetting the window clears observations, in-flight calls and cadence", () => {
  const state = makeState();
  state.observe({ kind: "prompt", at: 1, text: "x" });
  state.pendingTools.set("a", { toolName: "bash" });
  state.turnsSinceAppraisal = 5;
  state.resetWindow();
  assert.equal(state.observations.length, 0);
  assert.equal(state.pendingTools.size, 0);
  assert.equal(state.turnsSinceAppraisal, 0);
});

test("the session budget caps appraisals and 0 means unlimited", () => {
  const state = makeState();
  state.config.maxAppraisalsPerSession = 2;
  assert.equal(state.budgetAvailable(), true);
  state.appraisalsThisSession = 2;
  assert.equal(state.budgetAvailable(), false);
  state.config.maxAppraisalsPerSession = 0;
  assert.equal(state.budgetAvailable(), true);
});

test("registering the observer tracks every subscription for shutdown", () => {
  const { state } = wired();
  assert.equal(state.unsubscribers.length, 4, "input, tool start, tool end, turn end");
});