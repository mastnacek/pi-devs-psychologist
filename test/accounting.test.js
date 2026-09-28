/**
 * Accounting in `/psych` (T27).
 *
 * The report's "Last run" block and its session line are the only place the operator sees what an
 * appraisal cost — the engine's own meter cannot be told about a background call. The block must be
 * width-safe (a narrow terminal truncates, never corrupts) and the session cost cap must refuse the
 * next run BEFORE it spawns, naming the reason `cost`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { maybeAppraise } from "../src/slices/appraiser/index.js";
import { renderReport } from "../src/slices/report/index.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

function stateWith(over = {}, agentOver = {}) {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, model: "p/m", ...over, agent: { ...DEFAULT_CONFIG.agent, ...agentOver } };
  return state;
}

function runAccount(over = {}) {
  return {
    runtime: "agent",
    model: "openrouter/deepseek-v4.1-flash",
    context: "digest",
    durationMs: 11_100,
    toolCounts: { read: 3, psych_submit: 1 },
    inputTokens: 38_634,
    outputTokens: 438,
    costUsd: 0.0015,
    stage: "ok",
    ...over,
  };
}

function report(state, width) {
  return renderReport({ state, signals: [], history: [], lang: "en", ...(width ? { width } : {}) });
}

test("the report shows the last run's runtime, model, context, duration, tools, tokens and cost", () => {
  const state = stateWith({ runtime: "agent" }, { context: "digest" });
  state.lastRun = runAccount();
  state.agentRunsThisSession = 2;
  state.agentSessionCostUsd = 0.003;

  const text = report(state);
  assert.match(text, /Last run/);
  assert.match(text, /runtime\s+agent/);
  assert.match(text, /openrouter\/deepseek-v4\.1-flash/);
  assert.match(text, /context\s+digest/);
  assert.match(text, /duration\s+11\.1s/);
  assert.match(text, /read ×3, psych_submit ×1/);
  assert.match(text, /38634 in \/ 438 out/);
  assert.match(text, /\$0\.0015/);
  assert.match(text, /outcome\s+ok/);
  // The session line: runs and cost against the cap (the default 2 USD).
  assert.match(text, /runs this session: 2/);
  assert.match(text, /\$0\.0030 \/ \$2\.00/);
});

test("a failed run reports its stage, not a stale 'ok'", () => {
  const state = stateWith({ runtime: "agent" });
  state.lastRun = runAccount({ stage: "timeout", toolCounts: {} });
  assert.match(report(state), /outcome\s+timeout/);
  assert.match(report(state), /tools\s+—/, "an empty census renders a dash, not a blank");
});

test("a zero session cap is shown as unlimited, not as zero", () => {
  const state = stateWith({ runtime: "agent" }, { maxCostUsdPerSession: 0 });
  state.lastRun = runAccount();
  assert.match(report(state), /unlimited/);
});

test("reaching the session cap is stated, and the report is width-safe", () => {
  const state = stateWith({ runtime: "agent" }, { maxCostUsdPerSession: 2 });
  state.lastRun = runAccount();
  state.agentSessionCostUsd = 2.5;
  const text = report(state, 80);
  assert.match(text, /cost cap reached/);
  for (const line of text.split("\n")) {
    assert.ok(line.length <= 80, `line over width: ${JSON.stringify(line)}`);
  }
});

test("the cost cap refuses the next run with reason 'cost', before any spawn", async () => {
  const pi = makePi();
  const state = stateWith(
    { runtime: "agent", trigger: "cadence", cadenceTurns: 1 },
    { maxCostUsdPerSession: 0.5 },
  );
  state.turnsSinceAppraisal = 5;
  state.agentSessionCostUsd = 0.6;
  let calls = 0;
  const deps = {
    readHistory: () => ({ evidence: [] }),
    callModel: async () => {
      calls += 1;
      return { ok: true, text: "{}", provider: "p", modelId: "m", label: "p/m", usage: undefined };
    },
    deliver: async () => ({ human: "card", agent: false }),
  };

  const outcome = await maybeAppraise(pi, state, makeCtx(), deps);
  assert.deepEqual(outcome, { ran: false, reason: "cost" });
  assert.equal(calls, 0, "the run was refused before the model call");
});

test("below the cap the run proceeds, so the guard is not a blanket refusal", async () => {
  const pi = makePi();
  const state = stateWith(
    { runtime: "agent", trigger: "cadence", cadenceTurns: 1 },
    { maxCostUsdPerSession: 2 },
  );
  state.turnsSinceAppraisal = 5;
  state.agentSessionCostUsd = 0.5;
  let calls = 0;
  const deps = {
    readHistory: () => ({ evidence: [] }),
    callModel: async () => {
      calls += 1;
      return { ok: false, stage: "request", error: "downstream" };
    },
    deliver: async () => ({ human: "card", agent: false }),
  };
  const outcome = await maybeAppraise(pi, state, makeCtx(), deps);
  assert.equal(outcome.ran, true);
  assert.equal(calls, 1);
  // And the failed run is still accounted, so the report names the run that happened.
  assert.equal(state.lastRun.stage, "request");
  assert.equal(state.lastRun.runtime, "agent");
});