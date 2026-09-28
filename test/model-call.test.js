/**
 * Model call — reference parsing, resolution, and every failure stage.
 *
 * The reference parser is tested first and hardest because it has one job that is easy to
 * get wrong in a way nobody notices until it fails in production: splitting
 * `provider/modelId` on the FIRST slash, because OpenRouter model ids contain slashes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  callModel,
  parseModelRef,
  resolveModel,
  summarizeUsage,
} from "../src/shared/model-call.js";

const MODEL = { id: "deepseek/deepseek-v4.1-flash", provider: "openrouter-soukr", baseUrl: "https://x" };

function textMessage(over = {}) {
  return {
    role: "assistant",
    content: [{ type: "text", text: "{}" }],
    stopReason: "stop",
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { total: 0.001 } },
    timestamp: 1,
    ...over,
  };
}

function makeRegistry(over = {}) {
  const seen = { complete: [], auth: [] };
  return {
    seen,
    find: () => MODEL,
    getAll: () => [MODEL],
    getApiKeyAndHeaders: async (model) => {
      seen.auth.push(model);
      return { ok: true, apiKey: "k", headers: { "x-h": "v" }, env: { E: "1" }, baseUrl: "https://b" };
    },
    complete: async (model, context, options) => {
      seen.complete.push({ model, context, options });
      return textMessage();
    },
    ...over,
  };
}

const REQ = { modelRef: "openrouter-soukr/deepseek/deepseek-v4.1-flash", systemPrompt: "S", userText: "U", maxTokens: 100 };

test("a model reference splits on the first slash, so OpenRouter ids survive", () => {
  assert.deepEqual(parseModelRef("openrouter-soukr/deepseek/deepseek-v4.1-flash"), {
    provider: "openrouter-soukr",
    modelId: "deepseek/deepseek-v4.1-flash",
  });
  assert.deepEqual(parseModelRef("anthropic/claude-sonnet-4-5"), {
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
  });
  assert.deepEqual(parseModelRef("  a/b/c  "), { provider: "a", modelId: "b/c" });
});

test("a reference without both halves is not a reference", () => {
  for (const bad of ["", "   ", "noSlash", "/leading", "trailing/", 42, null, undefined]) {
    assert.equal(parseModelRef(bad), undefined, JSON.stringify(bad));
  }
});

test("resolution uses find() first and falls back to scanning the catalog", () => {
  assert.equal(resolveModel(makeRegistry(), "openrouter-soukr/deepseek/deepseek-v4.1-flash").label,
    "openrouter-soukr/deepseek/deepseek-v4.1-flash");

  // `find` misses, the catalog has it: a model visible in the picker must resolve.
  const fallback = makeRegistry({ find: () => undefined });
  assert.equal(resolveModel(fallback, "openrouter-soukr/deepseek/deepseek-v4.1-flash").model, MODEL);

  const absent = makeRegistry({ find: () => undefined, getAll: () => [] });
  assert.equal(resolveModel(absent, "a/b"), undefined);
});

test("an empty reference fails at the config stage and never reaches the provider", async () => {
  const registry = makeRegistry();
  const result = await callModel(registry, { ...REQ, modelRef: "  " });
  assert.deepEqual(result, { ok: false, stage: "config", error: "no psychologist model configured" });
  assert.equal(registry.seen.complete.length, 0);
  assert.equal(registry.seen.auth.length, 0);
});

test("an unknown model fails at resolve, before any auth or spend", async () => {
  const registry = makeRegistry({ find: () => undefined, getAll: () => [] });
  const result = await callModel(registry, { ...REQ, modelRef: "nope/missing" });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "resolve");
  assert.match(result.error, /not in the registry/);
  assert.equal(registry.seen.complete.length, 0);
});

test("missing credentials fail at auth, and the provider is never called", async () => {
  const registry = makeRegistry({ getApiKeyAndHeaders: async () => ({ ok: false, error: "no key" }) });
  const result = await callModel(registry, REQ);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "auth");
  assert.match(result.error, /no key/);
  assert.equal(registry.seen.complete.length, 0, "an unauthenticated call must not be attempted");
});

test("an auth throw is a result, not an exception", async () => {
  const registry = makeRegistry({
    getApiKeyAndHeaders: async () => {
      throw new Error("token refresh failed");
    },
  });
  const result = await callModel(registry, REQ);
  assert.equal(result.stage, "auth");
  assert.match(result.error, /token refresh failed/);
});

test("a provider throw is a request-stage result", async () => {
  const registry = makeRegistry({
    complete: async () => {
      throw new Error("ECONNRESET");
    },
  });
  const result = await callModel(registry, REQ);
  assert.equal(result.stage, "request");
  assert.match(result.error, /ECONNRESET/);
  assert.match(result.error, /openrouter-soukr\/deepseek/, "the failing model is named");
});

test("a provider-reported error and an empty response are response-stage results", async () => {
  const errored = await callModel(
    makeRegistry({ complete: async () => textMessage({ stopReason: "error", errorMessage: "rate limited" }) }),
    REQ,
  );
  assert.equal(errored.stage, "response");
  assert.match(errored.error, /rate limited/);

  const empty = await callModel(
    makeRegistry({ complete: async () => textMessage({ content: [{ type: "text", text: "   " }] }) }),
    REQ,
  );
  assert.equal(empty.stage, "response");
  assert.match(empty.error, /empty response/);
});

test("a successful call returns text, attribution and usage", async () => {
  const registry = makeRegistry({
    complete: async () => textMessage({ content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: " he" }, { type: "text", text: "llo " }] }),
  });
  const result = await callModel(registry, REQ);
  assert.equal(result.ok, true);
  assert.equal(result.text, "hello", "text parts are joined and trimmed, thinking is ignored");
  assert.equal(result.provider, "openrouter-soukr");
  assert.equal(result.modelId, "deepseek/deepseek-v4.1-flash");
  assert.equal(result.label, "openrouter-soukr/deepseek/deepseek-v4.1-flash");
  assert.equal(result.usage.totalTokens, 15);
});

test("the request carries resolved auth, the token cap and the abort signal", async () => {
  const registry = makeRegistry();
  const signal = new AbortController().signal;
  await callModel(registry, { ...REQ, maxTokens: 777, signal });
  const { context, options } = registry.seen.complete[0];
  assert.equal(context.systemPrompt, "S");
  assert.equal(context.messages[0].role, "user");
  assert.equal(context.messages[0].content, "U");
  assert.equal(typeof context.messages[0].timestamp, "number", "UserMessage requires a timestamp");
  assert.equal(options.apiKey, "k");
  assert.deepEqual(options.headers, { "x-h": "v" });
  assert.deepEqual(options.env, { E: "1" });
  assert.equal(options.maxTokens, 777);
  assert.equal(options.signal, signal);
  assert.equal(options.temperature, undefined, "no sampling overrides: a provider may reject them");
});

test("summarizeUsage keeps the figures worth reporting and tolerates absence", () => {
  assert.equal(summarizeUsage(undefined), undefined);
  assert.deepEqual(summarizeUsage(textMessage().usage), {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: 0.001,
  });
  // A usage object without cost must not produce NaN in the report.
  const partial = summarizeUsage({ input: 1, output: 2, totalTokens: 3 });
  assert.equal(partial.cost, 0);
  assert.equal(partial.cacheRead, 0);
});