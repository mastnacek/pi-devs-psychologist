/**
 * The run-time context decision (T28/T29): digest wiring, the fork consent, and the fallbacks.
 *
 * The load-bearing rule is that a wider boundary never happens silently. These tests pin every way
 * `fork` degrades to `digest` — no session file, no terminal, a declined confirm — and that the
 * appraiser's request carries a digest for the agent runtime and NONE for the API runtime.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { estimateContextSize, resolveAgentContext } from "../src/shared/agent-context.js";
import { stringsFor } from "../src/shared/i18n.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { maybeAppraise } from "../src/slices/appraiser/index.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

function stateFor(agentOver = {}, over = {}) {
  const state = makeState();
  state.config = {
    ...DEFAULT_CONFIG,
    model: "p/m",
    trigger: "cadence",
    ...over,
    agent: { ...DEFAULT_CONFIG.agent, ...agentOver },
  };
  state.agentForkConsent = "unknown";
  state.agentForkNotified = false;
  return state;
}

function ctxFor({ branch = [], mode = "tui", sessionFile, registry, confirm } = {}) {
  const notes = [];
  const prompts = [];
  const ctx = makeCtx({
    mode,
    sessionManager: { getBranch: () => branch, getEntries: () => [], getSessionFile: () => sessionFile, getSessionDir: () => ".sessions" },
    ...(registry ? { modelRegistry: registry } : {}),
    ui: {
      setStatus: () => {},
      notify: (message, level) => notes.push({ message, level }),
      confirm: async (title, body) => {
        prompts.push({ title, body });
        return confirm ? confirm(title, body) : true;
      },
    },
  });
  return { ctx, notes, prompts };
}

function assistant(input, cacheRead = 0) {
  return {
    type: "message",
    id: "a1",
    parentId: null,
    timestamp: "2024-01-01T00:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      usage: { input, cacheRead, output: 1, cacheWrite: 0, totalTokens: input + 1, cost: {} },
      stopReason: "stop",
      timestamp: 1,
    },
  };
}

test("estimateContextSize reads the latest assistant input (+cache) and prices it at the model rate", () => {
  const branch = [assistant(100), assistant(1234, 66)];
  assert.deepEqual(estimateContextSize(branch), { tokens: 1300, priceUsd: undefined });
  const priced = estimateContextSize(branch, { cost: { input: 3 } });
  assert.equal(priced.tokens, 1300);
  assert.equal(priced.priceUsd, (1300 / 1_000_000) * 3);
});

test("'digest' builds the excerpt and never asks a question", async () => {
  const state = stateFor({ context: "digest" });
  const { ctx, prompts } = ctxFor({ branch: [{ type: "message", message: { role: "user", content: "fix the tests" } }] });
  const resolved = await resolveAgentContext(state, ctx);
  assert.equal(resolved.context, "digest");
  assert.match(resolved.digest, /user: fix the tests/);
  assert.equal(prompts.length, 0, "digest needs no consent beyond the persisted one");
});

test("'fork' with no session file falls back to digest and notifies once per session", async () => {
  const state = stateFor({ context: "fork" });
  const { ctx, notes } = ctxFor({ branch: [assistant(10)], sessionFile: undefined });
  const first = await resolveAgentContext(state, ctx);
  assert.equal(first.context, "digest");
  assert.equal(notes.length, 1, "one notice");
  assert.equal(notes[0].message, stringsFor("en").contextForkNoSession);
  const second = await resolveAgentContext(state, ctx);
  assert.equal(second.context, "digest");
  assert.equal(notes.length, 1, "and only one, for the whole session");
});

test("'fork' outside a terminal (RPC) is refused and degrades to digest", async () => {
  const state = stateFor({ context: "fork" });
  const { ctx, notes } = ctxFor({ branch: [assistant(10)], mode: "rpc", sessionFile: "C:/sessions/p.jsonl" });
  const resolved = await resolveAgentContext(state, ctx);
  assert.equal(resolved.context, "digest");
  assert.equal(notes[0].message, stringsFor("en").contextForkNeedsTui);
});

test("a declined fork confirm holds for the session and degrades to digest", async () => {
  const state = stateFor({ context: "fork" });
  const { ctx, prompts } = ctxFor({
    branch: [assistant(10)],
    sessionFile: "C:/sessions/p.jsonl",
    confirm: async () => false,
  });
  const resolved = await resolveAgentContext(state, ctx);
  assert.equal(resolved.context, "digest");
  assert.equal(state.agentForkConsent, "declined");
  assert.equal(prompts.length, 1, "asked once");
  // A second run does not ask again.
  await resolveAgentContext(state, ctx);
  assert.equal(prompts.length, 1);
});

test("an approved fork yields the session file and its confirm states the token count", async () => {
  const state = stateFor({ context: "fork" });
  const { ctx, prompts } = ctxFor({ branch: [assistant(1234, 66)], sessionFile: "C:/sessions/p.jsonl" });
  const resolved = await resolveAgentContext(state, ctx);
  assert.equal(resolved.context, "fork");
  assert.equal(resolved.parentSessionFile, "C:/sessions/p.jsonl");
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].body, /1300/, "the confirm names the estimated token count");
});

test("a known child model adds its price to the confirm", async () => {
  const state = stateFor({ context: "fork" }, { model: "prov/model" });
  const model = { provider: "prov", id: "model", cost: { input: 2 } };
  const registry = {
    find: (p, id) => (p === "prov" && id === "model" ? model : undefined),
    getAll: () => [model],
  };
  const { ctx, prompts } = ctxFor({ branch: [assistant(1000)], sessionFile: "C:/sessions/p.jsonl", registry });
  const resolved = await resolveAgentContext(state, ctx);
  assert.equal(resolved.context, "fork");
  assert.match(prompts[0].body, /\$0\.0020/, "1000 tokens at $2/M is $0.0020");
});

/** The appraiser hands `req` to the model seam; this captures it. */
function depsWithCapture(calls) {
  return {
    readHistory: () => ({ evidence: [] }),
    callModel: async (_registry, req) => {
      calls.push(req);
      return { ok: false, stage: "request", error: "stop here" };
    },
    deliver: async () => ({ human: "none", agent: false, reason: "silent" }),
  };
}

test("agent + digest puts the digest in the request; API runtime never does", async () => {
  const branch = [{ type: "message", message: { role: "user", content: "the operator prompt" } }];
  const ctx = makeCtx({
    sessionManager: { getBranch: () => branch, getEntries: () => [], getSessionFile: () => undefined, getSessionDir: () => ".sessions" },
  });

  const agentCalls = [];
  await maybeAppraise(makePi(), stateFor({ context: "digest" }, { runtime: "agent" }), ctx, depsWithCapture(agentCalls), {
    force: true,
  });
  assert.match(agentCalls[0].digest, /the operator prompt/, "the agent request carries the digest");

  const apiCalls = [];
  await maybeAppraise(makePi(), stateFor({ context: "digest" }, { runtime: "api" }), ctx, depsWithCapture(apiCalls), {
    force: true,
  });
  assert.equal(apiCalls[0].digest, undefined, "the API request carries no digest");
  assert.equal(apiCalls[0].agentContext, undefined);
});
