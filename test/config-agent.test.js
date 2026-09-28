/**
 * Config — the `runtime` switch and the nested `agent` object (T21).
 *
 * The two assertions worth defending here: every `agent` key normalises on its own, so one junk
 * value cannot lose the rest; and the `agent` object merges PER KEY across the global and project
 * layers, so a project patch that sets `agent.maxCostUsd` does not silently reset the consent level
 * the global file chose.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_CONFIG,
  effectiveAgentModel,
  loadConfig,
  normalizeConfig,
  projectConfigPath,
  saveConfig,
} from "../src/shared/config.js";

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "psych-agent-cfg-"));
  const globalFile = join(root, "global.json");
  const cwd = join(root, "project");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  return { root, cwd, globalFile, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("defaults: runtime is api, context is evidence, and agent is the documented default set", () => {
  assert.equal(DEFAULT_CONFIG.runtime, "api");
  assert.deepEqual(DEFAULT_CONFIG.agent, DEFAULT_AGENT_CONFIG);
  assert.equal(DEFAULT_CONFIG.agent.context, "evidence", "the default sends counts only");
  assert.equal(DEFAULT_CONFIG.agent.timeoutMs, 180000);
  assert.equal(DEFAULT_CONFIG.agent.keepTranscript, false);
});

test("runtime normalises to api unless the value is exactly agent", () => {
  assert.equal(normalizeConfig({ runtime: "agent" }).runtime, "agent");
  assert.equal(normalizeConfig({ runtime: "api" }).runtime, "api");
  for (const junk of ["AGENT", "child", "", null, 42, {}, []]) {
    assert.equal(normalizeConfig({ runtime: junk }).runtime, "api", `junk runtime ${JSON.stringify(junk)}`);
  }
});

test("every agent key normalises independently, and junk becomes the default", () => {
  const agent = normalizeConfig({
    agent: {
      model: 42,
      thinking: "loud",
      context: "everything",
      timeoutMs: -1,
      maxToolCalls: "abc",
      maxCostUsd: -5,
      maxCostUsdPerSession: "x",
      allowWeb: "yes",
      allowMcp: 0,
      allowNlm: null,
      nlmNotebooks: "nb",
      extraArgs: [1, "  two  ", ""],
      keepTranscript: "yes",
    },
  }).agent;
  assert.equal(agent.model, "", "a non-string model fails to no model");
  assert.equal(agent.thinking, "", "an unknown thinking level is unset");
  assert.equal(agent.context, "evidence", "an unknown consent level falls back to the narrowest");
  assert.equal(agent.timeoutMs, DEFAULT_AGENT_CONFIG.timeoutMs, "a negative number is a typo");
  assert.equal(agent.maxToolCalls, DEFAULT_AGENT_CONFIG.maxToolCalls, "a non-number is a typo");
  assert.equal(agent.maxCostUsd, DEFAULT_AGENT_CONFIG.maxCostUsd);
  assert.equal(agent.maxCostUsdPerSession, DEFAULT_AGENT_CONFIG.maxCostUsdPerSession);
  // Default-on capabilities: only `false` disables them, so junk keeps them on.
  assert.equal(agent.allowWeb, true);
  assert.equal(agent.allowMcp, true);
  assert.equal(agent.allowNlm, true);
  assert.deepEqual(agent.nlmNotebooks, [], "a non-array is not a notebook list");
  assert.deepEqual(agent.extraArgs, ["two"], "array members that are not strings are dropped and trimmed");
  assert.equal(agent.keepTranscript, false, "only `true` enables it");
});

test("every agent key accepts a real value", () => {
  const agent = normalizeConfig({
    agent: {
      model: "  openrouter-soukr/deepseek/deepseek-v4.1-flash  ",
      thinking: "high",
      context: "fork",
      timeoutMs: 0,
      maxToolCalls: 0,
      maxCostUsd: 0,
      maxCostUsdPerSession: 0,
      allowWeb: false,
      allowMcp: false,
      allowNlm: false,
      nlmNotebooks: ["nb1", "nb2"],
      extraArgs: ["--no-lens"],
      keepTranscript: true,
    },
  }).agent;
  assert.equal(agent.model, "openrouter-soukr/deepseek/deepseek-v4.1-flash", "trimmed");
  assert.equal(agent.thinking, "high");
  assert.equal(agent.context, "fork");
  assert.equal(agent.timeoutMs, 0, "0 is finite and >= 0, so it is kept");
  assert.equal(agent.maxCostUsd, 0, "0 means unlimited, a real value");
  assert.equal(agent.allowWeb, false);
  assert.deepEqual(agent.nlmNotebooks, ["nb1", "nb2"]);
  assert.deepEqual(agent.extraArgs, ["--no-lens"]);
  assert.equal(agent.keepTranscript, true);
});

test("an agent value that is not an object falls back to the whole default set", () => {
  assert.deepEqual(normalizeConfig({ agent: "nope" }).agent, DEFAULT_AGENT_CONFIG);
  assert.deepEqual(normalizeConfig({ agent: null }).agent, DEFAULT_AGENT_CONFIG);
});

test("the effective agent model: agent.model wins, empty falls back to the shared model", () => {
  const shared = { ...DEFAULT_CONFIG, model: "shared/m" };
  assert.equal(effectiveAgentModel(shared), "shared/m");
  assert.equal(
    effectiveAgentModel({ ...shared, agent: { ...DEFAULT_AGENT_CONFIG, model: "agent/m" } }),
    "agent/m",
  );
  assert.equal(effectiveAgentModel({ ...shared, model: "", agent: { ...DEFAULT_AGENT_CONFIG, model: "  " } }), "");
});

test("the agent object merges per key across layers, not by wholesale replacement", () => {
  const ws = workspace();
  try {
    writeFileSync(ws.globalFile, JSON.stringify({ agent: { context: "fork", maxToolCalls: 9 } }), "utf8");
    writeFileSync(projectConfigPath(ws.cwd), JSON.stringify({ agent: { maxCostUsd: 5 } }), "utf8");
    const cfg = loadConfig(ws.cwd, ws.globalFile);
    assert.equal(cfg.agent.context, "fork", "the global consent level survives a project patch");
    assert.equal(cfg.agent.maxToolCalls, 9, "so does the global tool cap");
    assert.equal(cfg.agent.maxCostUsd, 5, "the project value wins where it speaks");
    assert.equal(cfg.agent.timeoutMs, DEFAULT_AGENT_CONFIG.timeoutMs, "untouched keys keep the default");
  } finally {
    ws.cleanup();
  }
});

test("saving agent.model does not clobber agent.context in the same file", () => {
  const ws = workspace();
  try {
    saveConfig({ agent: { context: "fork" } }, true, ws.cwd, ws.globalFile);
    saveConfig({ agent: { model: "a/b" } }, true, ws.cwd, ws.globalFile);
    const layer = JSON.parse(readFileSync(ws.globalFile, "utf8"));
    assert.deepEqual(layer.agent, { context: "fork", model: "a/b" }, "both keys are in the file");
  } finally {
    ws.cleanup();
  }
});
