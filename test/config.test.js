/**
 * Config — the cascade and the coercion rules.
 *
 * The two assertions worth defending here: an unparsable model id must fail to
 * "no model" rather than silently selecting a different one (that is money spent
 * on the wrong observer), and the appraisal budget must be able to express
 * "unlimited" without a negative sentinel.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_CONFIG,
  loadConfig,
  normalizeConfig,
  projectConfigPath,
  saveConfig,
} from "../src/shared/config.js";

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "psych-cfg-"));
  const globalFile = join(root, "global.json");
  const cwd = join(root, "project");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  return {
    root,
    cwd,
    globalFile,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("defaults require no configuration at all, and cost nothing", () => {
  assert.equal(DEFAULT_CONFIG.enabled, true);
  assert.equal(DEFAULT_CONFIG.model, "", "empty model means no token is ever spent");
  assert.equal(DEFAULT_CONFIG.steerAgent, false, "an observer is not an authority");
  assert.equal(DEFAULT_CONFIG.maxAppraisalsPerSession, 12);
});

test("a missing config file falls back to defaults", () => {
  const ws = workspace();
  try {
    assert.deepEqual(loadConfig(ws.cwd, ws.globalFile), DEFAULT_CONFIG);
  } finally {
    ws.cleanup();
  }
});

test("the project layer wins over the global layer, which wins over defaults", () => {
  const ws = workspace();
  try {
    writeFileSync(ws.globalFile, JSON.stringify({ cadenceTurns: 4, model: "a/b" }), "utf8");
    writeFileSync(projectConfigPath(ws.cwd), JSON.stringify({ cadenceTurns: 20 }), "utf8");
    const cfg = loadConfig(ws.cwd, ws.globalFile);
    assert.equal(cfg.cadenceTurns, 20, "project wins");
    assert.equal(cfg.model, "a/b", "global survives where the project is silent");
    assert.equal(cfg.retainObservations, DEFAULT_CONFIG.retainObservations, "defaults survive both");
  } finally {
    ws.cleanup();
  }
});

test("a corrupt layer is skipped instead of breaking the session", () => {
  const ws = workspace();
  try {
    writeFileSync(ws.globalFile, "{ not json at all", "utf8");
    assert.deepEqual(loadConfig(ws.cwd, ws.globalFile), DEFAULT_CONFIG);
  } finally {
    ws.cleanup();
  }
});

test("an unparsable model id fails to no model, never to a guess", () => {
  assert.equal(normalizeConfig({ model: 42 }).model, "");
  assert.equal(normalizeConfig({ model: null }).model, "");
  assert.equal(normalizeConfig({ model: undefined }).model, "");
  assert.equal(normalizeConfig({ model: "   " }).model, "");
  assert.equal(normalizeConfig({ model: "  anthropic/claude  " }).model, "anthropic/claude");
});

test("junk numbers become the default, not zero or NaN", () => {
  assert.equal(normalizeConfig({ cadenceTurns: -3 }).cadenceTurns, DEFAULT_CONFIG.cadenceTurns);
  assert.equal(normalizeConfig({ cadenceTurns: "abc" }).cadenceTurns, DEFAULT_CONFIG.cadenceTurns);
  assert.equal(normalizeConfig({ idleGapMs: 0 }).idleGapMs, DEFAULT_CONFIG.idleGapMs);
  assert.equal(normalizeConfig({ restatementThreshold: 5 }).restatementThreshold, DEFAULT_CONFIG.restatementThreshold);
  assert.equal(normalizeConfig({ restatementThreshold: 0 }).restatementThreshold, DEFAULT_CONFIG.restatementThreshold);
  assert.equal(normalizeConfig({ restatementThreshold: 0.5 }).restatementThreshold, 0.5);
});

test("0 is a real budget meaning unlimited, and negatives are not", () => {
  assert.equal(normalizeConfig({ maxAppraisalsPerSession: 0 }).maxAppraisalsPerSession, 0);
  assert.equal(normalizeConfig({ maxAppraisalsPerSession: -1 }).maxAppraisalsPerSession, DEFAULT_CONFIG.maxAppraisalsPerSession);
});

test("an unknown language is a typo, and English wins", () => {
  assert.equal(normalizeConfig({ lang: "de" }).lang, "en");
  assert.equal(normalizeConfig({ lang: "cs" }).lang, "cs");
});

test("a partial save merges into the target layer and does not freeze inherited values", () => {
  const ws = workspace();
  try {
    saveConfig({ cadenceTurns: 3, model: "x/y" }, true, ws.cwd, ws.globalFile);
    saveConfig({ cadenceTurns: 9 }, false, ws.cwd, ws.globalFile);

    const globalLayer = JSON.parse(readFileSync(ws.globalFile, "utf8"));
    const projectLayer = JSON.parse(readFileSync(projectConfigPath(ws.cwd), "utf8"));
    assert.deepEqual(globalLayer, { cadenceTurns: 3, model: "x/y" });
    assert.deepEqual(projectLayer, { cadenceTurns: 9 }, "the project layer holds only its own patch");
    assert.equal(loadConfig(ws.cwd, ws.globalFile).model, "x/y");
  } finally {
    ws.cleanup();
  }
});