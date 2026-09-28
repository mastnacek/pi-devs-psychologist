/**
 * The JSONL reducer (T24).
 *
 * The child's stdout is a live stream from a model: it can tear a record in half, emit an event type
 * this plugin does not know, or interleave a message the parent does not care about. None of that may
 * lose the answer that already arrived. Every case here is one of those, plus the two facts that
 * actually decide a run — the submission and the running cost.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  createStreamState,
  reduceLine,
  splitLines,
  totalCostUsd,
} from "../src/shared/agent-stream.js";

const SUBMIT_START = JSON.stringify({
  type: "tool_execution_start",
  toolCallId: "call_1",
  toolName: "psych_submit",
  args: { needs: {}, load: {}, progress: {}, flow: {}, interventions: [] },
});
const SUBMIT_END_OK = JSON.stringify({
  type: "tool_execution_end",
  toolCallId: "call_1",
  toolName: "psych_submit",
  isError: false,
});
const SUBMIT_END_ERR = JSON.stringify({
  type: "tool_execution_end",
  toolCallId: "call_1",
  toolName: "psych_submit",
  isError: true,
});

function assistant(cost, text = "thinking out loud") {
  return JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      usage: {
        input: 10,
        output: 4,
        cacheRead: 2,
        cacheWrite: 1,
        totalTokens: 14,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
      },
    },
  });
}

function feed(state, lines) {
  for (const line of lines) reduceLine(state, line);
}

test("a matching psych_submit start+end marks submitted and captures the arguments", () => {
  const state = createStreamState();
  feed(state, [SUBMIT_START, SUBMIT_END_OK]);
  assert.equal(state.submitted, true);
  assert.deepEqual(state.submittedArgs, {
    needs: {},
    load: {},
    progress: {},
    flow: {},
    interventions: [],
  });
});

test("an errored submit does not count; a later successful one does", () => {
  const state = createStreamState();
  feed(state, [SUBMIT_START, SUBMIT_END_ERR]);
  assert.equal(state.submitted, false, "isError:true means the child must retry");

  const second = JSON.stringify({
    type: "tool_execution_start",
    toolCallId: "call_2",
    toolName: "psych_submit",
    args: { retried: true },
  });
  const secondEnd = JSON.stringify({
    type: "tool_execution_end",
    toolCallId: "call_2",
    toolName: "psych_submit",
    isError: false,
  });
  feed(state, [second, secondEnd]);
  assert.equal(state.submitted, true);
  assert.deepEqual(state.submittedArgs, { retried: true });
});

test("an end for a different toolCallId never marks the submission accepted", () => {
  const state = createStreamState();
  feed(state, [SUBMIT_START]);
  reduceLine(
    state,
    JSON.stringify({ type: "tool_execution_end", toolCallId: "other", toolName: "psych_submit", isError: false }),
  );
  assert.equal(state.submitted, false);
});

test("no submission: a settled run with assistant text but no submit stays unsubmitted", () => {
  const state = createStreamState();
  feed(state, [assistant(0.01, "I could not decide"), JSON.stringify({ type: "agent_settled" })]);
  assert.equal(state.submitted, false);
  assert.equal(state.settled, true);
  assert.equal(state.lastAssistantText, "I could not decide");
});

test("garbage lines and unknown event types are ignored, not fatal", () => {
  const state = createStreamState();
  feed(state, ["", "   ", "not json at all", "{}", JSON.stringify({ type: "future_event", x: 1 })]);
  assert.equal(state.submitted, false);
  assert.equal(state.usage.cost, 0);
  assert.deepEqual(state.toolCounts, {});
});

test("unknown (non-psych_submit) tool starts are counted, not captured", () => {
  const state = createStreamState();
  feed(state, [
    JSON.stringify({ type: "tool_execution_start", toolCallId: "b1", toolName: "bash", args: {} }),
    JSON.stringify({ type: "tool_execution_start", toolCallId: "b2", toolName: "bash", args: {} }),
    JSON.stringify({ type: "tool_execution_start", toolCallId: "w1", toolName: "web_search", args: {} }),
  ]);
  assert.deepEqual(state.toolCounts, { bash: 2, web_search: 1 });
});

test("usage is summed across every assistant message_end, and only those", () => {
  const state = createStreamState();
  feed(state, [
    assistant(0.5, "one"),
    JSON.stringify({ type: "message_end", message: { role: "user", content: "hi" } }),
    assistant(0.25, "two"),
  ]);
  assert.deepEqual(state.usage, { input: 20, output: 8, cacheRead: 4, cacheWrite: 2, cost: 0.75 });
  assert.equal(totalCostUsd(state), 0.75);
  assert.equal(state.lastAssistantText, "two", "the LAST assistant text wins");
});

test("lastAssistantText is trimmed and capped at 300 characters", () => {
  const state = createStreamState();
  reduceLine(state, assistant(0, "x".repeat(500)));
  assert.equal(state.lastAssistantText.length, 300);
});

test("splitLines keeps a chunk torn mid-line as carry for the next chunk", () => {
  const first = splitLines("", '{"type":"a"}\n{"type":"b');
  assert.deepEqual(first.lines, ['{"type":"a"}']);
  assert.equal(first.carry, '{"type":"b');

  const second = splitLines(first.carry, '"}');
  assert.deepEqual(second.lines, [], "no newline yet, so no complete line");
  assert.equal(second.carry, '{"type":"b"}');

  const third = splitLines(second.carry, "\n");
  assert.deepEqual(third.lines, ['{"type":"b"}']);
  assert.equal(third.carry, "");
});

test("a record split across chunks reduces identically once the carry completes it", () => {
  const whole = createStreamState();
  reduceLine(whole, SUBMIT_START);
  reduceLine(whole, SUBMIT_END_OK);

  const chunked = createStreamState();
  const buffer = SUBMIT_START + "\n" + SUBMIT_END_OK + "\n";
  const mid = Math.floor(buffer.length / 2);
  const a = splitLines("", buffer.slice(0, mid));
  for (const line of a.lines) reduceLine(chunked, line);
  const b = splitLines(a.carry, buffer.slice(mid));
  for (const line of b.lines) reduceLine(chunked, line);

  assert.deepEqual(chunked, whole);
});
