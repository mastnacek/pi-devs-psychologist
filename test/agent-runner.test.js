/**
 * The process wrapper (T24) — driven by a FAKE child, never a real pi.
 *
 * The wrapper's job is to end a run correctly at the first of five conditions and to clean up after
 * itself. The fake `io` is a scripted child plus recorded kill/rm/write calls, so "the temp dir was
 * removed on the timeout path" is an assertion rather than a hope, and no test here needs a token.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runAgent } from "../src/shared/agent-runner.js";

/** A fake child: two stdout/stderr emitters plus the process events the runner listens to. */
function fakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

/** A fake io recording every side effect and handing back the queued children in order. */
function fakeIo(children) {
  const queue = [...children];
  const record = { spawn: [], killed: [], rm: [], written: [], timers: [] };
  let clock = 0;
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
      writeFile: (path, data) => {
        record.written.push({ path, data });
      },
      rm: (path) => {
        record.rm.push(path);
      },
      killTree: (pid) => {
        record.killed.push(pid);
      },
      now: () => (clock += 1000),
      setTimeout: (callback, ms) => {
        record.timers.push({ callback, ms });
        return record.timers.length;
      },
      clearTimeout: () => {},
    },
  };
}

function options(over = {}) {
  return {
    cliPath: "C:/engine/dist/bundle/cli.js",
    execPath: "C:/node/node.exe",
    role: "psychologist",
    context: "evidence",
    piVersion: "0.87.1",
    docsDir: "C:/engine/docs",
    thinking: "",
    trusted: true,
    cwd: "C:/work",
    timeoutMs: 60_000,
    maxCostUsd: 0.25,
    maxToolCalls: 25,
    allowWeb: true,
    allowMcp: true,
    allowNlm: true,
    nlmNotebooks: [],
    extraArgs: [],
    keepTranscript: false,
    ...over,
  };
}

const REQUEST = {
  modelRef: "openrouter-soukr/x/y",
  evidence: { liveLines: ["window: 0 prompt(s)"], sessionLines: ["session span: 3 min"] },
};

const SUBMIT_START = JSON.stringify({
  type: "tool_execution_start",
  toolCallId: "c1",
  toolName: "psych_submit",
  args: { ok: true },
});
const SUBMIT_END = JSON.stringify({
  type: "tool_execution_end",
  toolCallId: "c1",
  toolName: "psych_submit",
  isError: false,
});

function emitLine(child, json) {
  child.stdout.emit("data", Buffer.from(json + "\n"));
}

function emitAssistantCost(child, cost) {
  emitLine(
    child,
    JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: cost } },
      },
    }),
  );
}

test("success: the child's psych_submit args become the result text, and the temp dir is removed", async () => {
  const child = fakeChild();
  const { io, record } = fakeIo([child]);
  const promise = runAgent(REQUEST, options(), io);
  await new Promise((resolve) => setTimeout(resolve, 0));
  emitLine(child, SUBMIT_START);
  emitLine(child, SUBMIT_END);
  child.stdout.emit("data", Buffer.from('{"type":"spa')); // a torn trailing record: ignored
  child.emit("close", 0);

  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(result.text, JSON.stringify({ ok: true }));
  assert.equal(result.run.fallback, false);
  assert.equal(record.rm.length, 1, "the run directory is removed");
});

test("a non-zero exit without submission is stage 'exit' and names the code", async () => {
  const child = fakeChild();
  const { io } = fakeIo([child]);
  const promise = runAgent(REQUEST, options(), io);
  await new Promise((resolve) => setTimeout(resolve, 0));
  child.stderr.emit("data", Buffer.from("boom"));
  child.emit("close", 3);

  const result = await promise;
  assert.equal(result.ok, false);
  assert.equal(result.stage, "exit");
  assert.match(result.error, /code 3/);
  assert.match(result.error, /boom/, "the stderr tail explains the failure");
});

test("a settled run that never submitted is stage 'no_submission'", async () => {
  const child = fakeChild();
  const { io } = fakeIo([child]);
  const promise = runAgent(REQUEST, options(), io);
  await new Promise((resolve) => setTimeout(resolve, 0));
  emitLine(child, JSON.stringify({ type: "agent_settled" }));
  emitLine(
    child,
    JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "no idea" }] } }),
  );
  child.emit("close", 0);

  const result = await promise;
  assert.equal(result.ok, false);
  assert.equal(result.stage, "no_submission");
  assert.match(result.error, /no idea/);
});

test("timeout: the injected clock fires, the tree is killed and the stage is 'timeout'", async () => {
  const child = fakeChild();
  const { io, record } = fakeIo([child]);
  const promise = runAgent(REQUEST, options({ timeoutMs: 1000 }), io);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(record.timers.length, 1);
  assert.equal(record.timers[0].ms, 1000);
  record.timers[0].callback();

  const result = await promise;
  assert.equal(result.stage, "timeout");
  assert.deepEqual(record.killed, [4242], "the child tree was killed");
  assert.equal(record.rm.length, 1);
});

test("over-budget: a cost past the per-run cap kills the child and reports 'budget'", async () => {
  const child = fakeChild();
  const { io, record } = fakeIo([child]);
  const promise = runAgent(REQUEST, options({ maxCostUsd: 0.1 }), io);
  await new Promise((resolve) => setTimeout(resolve, 0));
  emitAssistantCost(child, 0.5);

  const result = await promise;
  assert.equal(result.stage, "budget");
  assert.deepEqual(record.killed, [4242]);
  assert.equal(result.run.costUsd, 0.5, "the figures are returned for accounting");
});

test("an abort signal kills the child and reports 'aborted'", async () => {
  const child = fakeChild();
  const { io, record } = fakeIo([child]);
  const controller = new AbortController();
  const promise = runAgent({ ...REQUEST, signal: controller.signal }, options(), io);
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();

  const result = await promise;
  assert.equal(result.stage, "aborted");
  assert.deepEqual(record.killed, [4242]);
});

test("a spawn failure is stage 'spawn', not a rejection", async () => {
  const { io } = fakeIo([]); // the queue is empty, so spawn throws
  const result = await runAgent(REQUEST, options(), io);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "spawn");
});

test("keepTranscript keeps the run directory and names the JSONL in the result", async () => {
  const child = fakeChild();
  const { io, record } = fakeIo([child]);
  const promise = runAgent(REQUEST, options({ keepTranscript: true }), io);
  await new Promise((resolve) => setTimeout(resolve, 0));
  emitLine(child, SUBMIT_START);
  emitLine(child, SUBMIT_END);
  child.emit("close", 0);

  const result = await promise;
  assert.equal(record.rm.length, 0, "the directory is kept");
  const events = record.written.find((w) => w.path.endsWith("events.jsonl"));
  assert.ok(events, "the raw stream was written");
  assert.ok(events.data.includes("psych_submit"));
  assert.equal(result.run.transcriptPath, events.path);
});

test("the child is announced with a kill handle and cleared when the run ends", async () => {
  const child = fakeChild();
  const { io, record } = fakeIo([child]);
  const handles = [];
  const promise = runAgent(REQUEST, options({ onChild: (h) => handles.push(h) }), io);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(typeof handles[0].kill, "function");

  emitLine(child, SUBMIT_START);
  emitLine(child, SUBMIT_END);
  child.emit("close", 0);
  await promise;
  assert.equal(handles.at(-1), undefined, "the handle is released at the end");
});

test("kill is idempotent: timeout then close kills once", async () => {
  const child = fakeChild();
  const { io, record } = fakeIo([child]);
  const promise = runAgent(REQUEST, options({ timeoutMs: 1000 }), io);
  await new Promise((resolve) => setTimeout(resolve, 0));
  record.timers[0].callback();
  child.emit("close", null);
  await promise;
  assert.deepEqual(record.killed, [4242], "one kill, not two");
});

test("onProgress reports the tool census and elapsed time as the child streams (T26)", async () => {
  const child = fakeChild();
  const { io } = fakeIo([child]);
  const seen = [];
  const promise = runAgent(REQUEST, options({ onProgress: (p) => seen.push(p) }), io);
  await new Promise((resolve) => setTimeout(resolve, 0));
  emitLine(child, SUBMIT_START);
  emitLine(
    child,
    JSON.stringify({ type: "tool_execution_start", toolCallId: "x", toolName: "read" }),
  );
  emitLine(child, SUBMIT_END);
  child.emit("close", 0);
  await promise;

  assert.ok(seen.length > 0, "progress was reported");
  const last = seen.at(-1);
  assert.equal(last.toolCalls, 2, "psych_submit and read are both counted");
  assert.equal(typeof last.elapsedMs, "number");
});
